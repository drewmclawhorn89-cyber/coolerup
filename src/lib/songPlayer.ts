import { useSyncExternalStore } from "react";
import type { Sound } from "@/lib/sounds";
import { extractYouTubeId } from "@/lib/youtube";
import {
  loadYouTubeAudio,
  pauseYouTubeAudio,
  playYouTubeAudio,
  seekYouTubeAudio,
  setYouTubeAudioListeners,
  setYouTubeVolume,
  stopYouTubeAudio,
} from "@/lib/youtubeAudio";

/**
 * One audio element for the whole app.
 *
 * The Music tab's player has to survive a route change ("doesn't stop when you
 * change tap"), so the state lives at module scope instead of inside a React
 * component. `<SongPlayerBar />` is mounted once in the root layout and simply
 * subscribes to this store.
 *
 * Two backends sit behind the same state:
 *
 * - Coolerup-owned audio (own uploads, royalty-free songs, downloaded blobs)
 *   plays through the shared `<audio>` element.
 * - YouTube songs play through the hidden IFrame player in `@/lib/youtubeAudio`,
 *   which lives outside the route tree so switching tabs never stops the song.
 *
 * Everything above that — queue, next/prev, seek, volume, the mini player and
 * the lock-screen controls — is backend-agnostic.
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
  /** "own" = Coolerup audio file, "youtube" = streamed from YouTube. */
  source?: "own" | "youtube";
  /** Watch link when the track is a YouTube song. */
  youtubeUrl?: string | null;
  /** Real cover image (YouTube thumbnail) when there is one. */
  coverUrl?: string | null;
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

/** True when this track streams from YouTube rather than a real audio file. */
export function isYouTubeTrack(track: PlayerTrack | null | undefined): boolean {
  if (!track) return false;
  return track.source === "youtube" && Boolean(extractYouTubeId(track.youtubeUrl ?? ""));
}

/** The YouTube video id behind a track, or null. */
export function trackYouTubeId(track: PlayerTrack | null | undefined): string | null {
  if (!track) return null;
  return extractYouTubeId(track.youtubeUrl ?? "");
}

/** Stop whichever backend is currently making noise. */
function silenceAudio() {
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
}

function playAt(i: number) {
  const track = state.queue[i];
  if (!track) return;

  // YouTube songs go through the hidden IFrame player. The shared <audio>
  // element is silenced first so the two backends never overlap.
  if (isYouTubeTrack(track)) {
    silenceAudio();
    set({ index: i, time: 0, duration: 0, error: "", loading: true, active: true });
    const videoId = trackYouTubeId(track);
    if (!videoId) {
      set({ error: "This YouTube song can't be played here. Try another.", loading: false });
      return;
    }
    setYouTubeVolume(state.volume * 100);
    void loadYouTubeAudio(videoId, true).catch(() =>
      set({ error: "Couldn't load the YouTube player. Check your connection.", loading: false }),
    );
    return;
  }

  const el = ensureAudio();
  if (!el) return;
  stopYouTubeAudio();
  set({ index: i, time: 0, duration: 0, error: "", loading: true, active: true });
  el.src = track.url;
  el.volume = state.volume;
  el.muted = state.muted;
  void el.play().catch(() => set({ playing: false, loading: false }));
}

/**
 * Bridge the hidden YouTube player into this store, once.
 *
 * Kept at module scope so it is wired the first time a song is played, whether
 * that happens from the Music tab or from the mini player.
 */
let youtubeBridgeInstalled = false;

function installYouTubeBridge() {
  if (youtubeBridgeInstalled || typeof window === "undefined") return;
  youtubeBridgeInstalled = true;
  setYouTubeAudioListeners({
    onProgress: (time, duration) => set({ time, duration }),
    onPlayingChange: (playing) => set({ playing, loading: false }),
    onLoadingChange: (loading) => set({ loading }),
    onEnded: () => {
      if (state.loop) {
        const track = state.queue[state.index];
        const videoId = trackYouTubeId(track);
        if (videoId) {
          void loadYouTubeAudio(videoId, true);
          return;
        }
      }
      songPlayer.next();
    },
    onError: (message) => set({ error: message, playing: false, loading: false }),
  });
}

installYouTubeBridge();

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
    const track = state.queue[state.index];
    if (isYouTubeTrack(track)) {
      if (state.playing) pauseYouTubeAudio();
      else playYouTubeAudio();
      return;
    }
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
    if (isYouTubeTrack(state.queue[state.index])) {
      seekYouTubeAudio(Math.max(0, seconds));
      set({ time: Math.max(0, seconds) });
      return;
    }
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
    setYouTubeVolume(volume * 100);
    set({ volume, muted: volume === 0 ? true : state.muted });
  },

  toggleMute() {
    const el = ensureAudio();
    const muted = !state.muted;
    if (el) el.muted = muted;
    setYouTubeVolume(muted ? 0 : state.volume * 100);
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
    stopYouTubeAudio();
    state = { ...initial, volume: state.volume, muted: state.muted };
    emit();
  },
};

/** Subscribe a component to the shared player. */
export function useSongPlayer(): SongPlayerState {
  return useSyncExternalStore(songPlayer.subscribe, songPlayer.getState, songPlayer.getState);
}

/* ===========================================================================
 * "Use this sound" bridge
 *
 * The mini player can be tapped from any screen, so the camera dialog listens
 * for a window event instead of living inside a route. Kept here (rather than
 * in a component) so `MiniPlayer` and the Music route can both import it
 * without a circular dependency.
 * =========================================================================== */

export const USE_SOUND_EVENT = "coolerup:use-sound";

/** Ask the app to open the camera with this song attached ("Use this sound"). */
export function requestUseSound(track: PlayerTrack) {
  window.dispatchEvent(new CustomEvent<PlayerTrack>(USE_SOUND_EVENT, { detail: track }));
}

/**
 * The shared player only knows `PlayerTrack`, but the download control needs a
 * `Sound` row. `audio_url` is already the resolved URL here, which is exactly
 * what `saveSongOffline` wants to fetch.
 */
export function trackToSound(track: PlayerTrack): Sound {
  return {
    id: track.soundId,
    original_video_id: null,
    audio_url: track.url,
    title: track.title,
    creator_username: track.artist.replace(/^@/, ""),
    uses_count: 0,
    created_at: "",
    source: track.source ?? "own",
    youtube_url: track.youtubeUrl ?? null,
    cover_url: track.coverUrl ?? null,
  };
}
