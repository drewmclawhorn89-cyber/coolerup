import { useSyncExternalStore } from "react";

/**
 * One audio element for the whole app.
 *
 * The Music tab's player has to survive a route change ("doesn't stop when you
 * change tap"), so the state lives at module scope instead of inside a React
 * component. `<SongPlayerBar />` is mounted once in the root layout and simply
 * subscribes to this store.
 */

export type PlayerTrack = {
  /** The `sounds.id` — also used to key "saved" state. */
  soundId: string;
  title: string;
  /** "@username" of whoever uploaded the sound. */
  artist: string;
  /** Resolved, playable URL. */
  url: string;
  /** CSS gradient used as the cover. */
  cover: string;
};

export type SongPlayerState = {
  queue: PlayerTrack[];
  index: number;
  playing: boolean;
  time: number;
  duration: number;
  loop: boolean;
  volume: number;
  muted: boolean;
  loading: boolean;
  error: string;
  /** False until the user has opened a song at least once. */
  active: boolean;
};

const initial: SongPlayerState = {
  queue: [],
  index: 0,
  playing: false,
  time: 0,
  duration: 0,
  loop: false,
  volume: 0.9,
  muted: false,
  loading: false,
  error: "",
  active: false,
};

let state: SongPlayerState = initial;
let audio: HTMLAudioElement | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function set(patch: Partial<SongPlayerState>) {
  state = { ...state, ...patch };
  emit();
}

function ensureAudio(): HTMLAudioElement | null {
  if (typeof window === "undefined") return null;
  if (audio) return audio;

  const el = new Audio();
  el.preload = "metadata";
  el.volume = state.volume;

  el.addEventListener("timeupdate", () => set({ time: el.currentTime }));
  el.addEventListener("loadedmetadata", () =>
    set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }),
  );
  el.addEventListener("durationchange", () =>
    set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }),
  );
  el.addEventListener("play", () => set({ playing: true, loading: false }));
  el.addEventListener("pause", () => set({ playing: false }));
  el.addEventListener("waiting", () => set({ loading: true }));
  el.addEventListener("playing", () => set({ loading: false }));
  el.addEventListener("ended", () => {
    if (state.loop) {
      el.currentTime = 0;
      void el.play().catch(() => set({ playing: false }));
      return;
    }
    // Advance the shared queue (defined below; the listener only fires later).
    songPlayer.next();
  });
  el.addEventListener("error", () => {
    if (!el.src) return;
    set({ error: "Couldn't play that song. Try another.", playing: false, loading: false });
  });

  audio = el;
  return el;
}

function playAt(i: number) {
  const el = ensureAudio();
  const track = state.queue[i];
  if (!el || !track) return;
  set({ index: i, time: 0, duration: 0, error: "", loading: true, active: true });
  el.src = track.url;
  el.volume = state.volume;
  el.muted = state.muted;
  void el.play().catch(() => set({ playing: false, loading: false }));
}

export const songPlayer = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getState(): SongPlayerState {
    return state;
  },

  /** Replace the queue and start the given track. */
  playQueue(tracks: PlayerTrack[], startIndex = 0) {
    if (!tracks.length) return;
    const i = Math.max(0, Math.min(tracks.length - 1, startIndex));
    set({ queue: tracks, index: i, active: true });
    playAt(i);
  },

  /**
   * Swap in a fuller queue without interrupting the song that's already
   * playing. Used after a tap: playback starts immediately with one track,
   * then the rest of the row is resolved in the background.
   */
  replaceQueue(tracks: PlayerTrack[]) {
    if (!tracks.length) return;
    const current = state.queue[state.index];
    const i = current ? tracks.findIndex((t) => t.soundId === current.soundId) : -1;
    if (i >= 0) set({ queue: tracks, index: i });
    else set({ queue: tracks, index: 0 });
  },

  toggle() {
    const el = ensureAudio();
    if (!el) return;
    if (!el.src) {
      if (state.queue.length) playAt(state.index);
      return;
    }
    if (el.paused) void el.play().catch(() => set({ playing: false }));
    else el.pause();
  },

  next() {
    if (!state.queue.length) return;
    if (state.index >= state.queue.length - 1) {
      if (state.loop) playAt(0);
      return;
    }
    playAt(state.index + 1);
  },

  prev() {
    if (!state.queue.length) return;
    const el = audio;
    // TikTok/Spotify behaviour: restart the track unless you're in the first 3s.
    if (el && el.currentTime > 3) {
      el.currentTime = 0;
      return;
    }
    playAt(state.index <= 0 ? 0 : state.index - 1);
  },

  seek(seconds: number) {
    const el = ensureAudio();
    if (!el) return;
    el.currentTime = Math.max(0, seconds);
    set({ time: el.currentTime });
  },

  setVolume(v: number) {
    const el = ensureAudio();
    const volume = Math.max(0, Math.min(1, v));
    if (el) {
      el.volume = volume;
      el.muted = volume === 0 ? true : el.muted;
    }
    set({ volume, muted: volume === 0 ? true : state.muted });
  },

  toggleMute() {
    const el = ensureAudio();
    if (!el) return;
    const muted = !el.muted;
    el.muted = muted;
    set({ muted });
  },

  toggleLoop() {
    const el = ensureAudio();
    const loop = !state.loop;
    if (el) el.loop = loop;
    set({ loop });
  },

  /** Stop playback and hide the dock. */
  stop() {
    const el = audio;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      el.load();
    }
    state = { ...initial, volume: state.volume, muted: state.muted };
    emit();
  },
};

/** Subscribe a component to the shared player. */
export function useSongPlayer(): SongPlayerState {
  return useSyncExternalStore(songPlayer.subscribe, songPlayer.getState, songPlayer.getState);
}
