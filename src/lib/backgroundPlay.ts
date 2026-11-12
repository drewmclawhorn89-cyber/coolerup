import { useSyncExternalStore } from "react";

import { readBool, writePref } from "@/lib/prefs";
import { songPlayer, type PlayerTrack } from "@/lib/songPlayer";

/**
 * Background Play
 * ---------------
 * Music keeps playing when the user switches top tabs (For You / Videos / Shop
 * / LIVE), locks the phone, or jumps to another app — the way Spotify works.
 *
 * Two things make that possible:
 *
 * 1. The Music tab plays through a single `HTMLAudioElement` created with
 *    `new Audio()` (see `@/lib/songPlayer`). Audio elements are not tied to a
 *    route or a visible `<video>` tag, so the browser keeps decoding them while
 *    the page is hidden. A `<video>` element pauses the moment it is hidden.
 *
 * 2. The Media Session API publishes the now-playing metadata to the OS, which
 *    is what draws the lock-screen / notification-shade controls (play, pause,
 *    next, previous, scrubber).
 *
 * YouTube is the one exception. YouTube's own IFrame player refuses to play
 * while the page is hidden, and there is no supported way around it — so we
 * detect those tracks and tell the user instead of pretending it works.
 *
 * Background play is a VIP perk. `setBackgroundPlayEntitled` is called by the
 * app whenever the signed-in user's plan changes; while it is false the feature
 * is off no matter what the stored preference says, and losing the entitlement
 * pauses whatever is playing right away. The preference is kept so a returning
 * VIP finds the toggle exactly where they left it.
 */

/** localStorage key (stored as `settings:background-play`). */
export const BACKGROUND_PLAY_KEY = "background-play";

/** Shown wherever a YouTube-backed song is playing. */
export const YOUTUBE_BACKGROUND_WARNING =
  "YouTube songs pause in background — YouTube blocks background play. Use your own MP3 or a royalty-free song for background play.";

/** Short version for the compact mini player. */
export const YOUTUBE_BACKGROUND_SHORT = "YouTube blocks background play";

/** Shown next to the toggle in Settings. */
export const BACKGROUND_PLAY_HELP =
  "Keep music playing when you switch tabs, lock your phone, or open another app. Works with your own MP3s, royalty-free songs, and anything you downloaded for offline.";

/** Default ON, per the spec — but only ever honoured for VIP listeners. */
const prefEnabled = (): boolean => readBool(BACKGROUND_PLAY_KEY, true);

/**
 * Whether the signed-in listener's plan includes background play.
 *
 * Kept in module state rather than localStorage: it is derived from the
 * subscription on every mount/focus, and a stale copy must never hand out a
 * perk the server has taken away.
 */
let entitled = false;

/** True when the current plan unlocks background play (VIP or lifetime). */
export const isBackgroundPlayEntitled = (): boolean => entitled;

/** True only when the plan allows it *and* the listener left the toggle on. */
export const isBackgroundPlayEnabled = (): boolean => entitled && prefEnabled();

const listeners = new Set<() => void>();
const emit = () => {
  for (const fn of listeners) fn();
};

/**
 * Update the plan entitlement. Called from the root player whenever the auth
 * handle or subscription changes.
 *
 * Losing the perk takes effect immediately: playback pauses and the OS controls
 * are cleared, so a downgraded account cannot keep listening in the background
 * until the next song.
 */
export function setBackgroundPlayEntitled(next: boolean) {
  if (entitled === next) return;
  entitled = next;
  emit();
  if (!next) {
    const state = songPlayer.getState();
    if (state.playing) songPlayer.toggle();
  }
  syncMediaSession();
}

export function subscribeBackgroundPlay(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Persist the preference and immediately reflect it in the OS controls.
 *
 * Returns false without writing anything when the listener is not entitled —
 * the UI should send them to the VIP upsell instead of pretending the switch
 * moved.
 */
export function setBackgroundPlayEnabled(enabled: boolean): boolean {
  if (enabled && !entitled) return false;
  writePref(BACKGROUND_PLAY_KEY, String(enabled));
  emit();
  if (!enabled) {
    // Turning the feature off should take effect now, not at the next song.
    const state = songPlayer.getState();
    if (state.playing) songPlayer.toggle();
  }
  syncMediaSession();
  return true;
}

/** React hook for the effective toggle state (entitled *and* switched on). */
export function useBackgroundPlay(): boolean {
  return useSyncExternalStore(subscribeBackgroundPlay, isBackgroundPlayEnabled, () => false);
}

/** React hook for whether the current plan includes background play. */
export function useBackgroundPlayEntitled(): boolean {
  return useSyncExternalStore(subscribeBackgroundPlay, isBackgroundPlayEntitled, () => false);
}

/** True when the track can keep playing with the screen off. */
export function canBackgroundPlay(track: PlayerTrack | null | undefined): boolean {
  if (!track) return false;
  // Anything with a real audio file (own upload, royalty-free, downloaded blob)
  // is fine. YouTube streams are not.
  return track.source !== "youtube";
}

/** Does this browser expose the Media Session API? */
export function isMediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

type MediaSessionLike = {
  metadata: unknown;
  playbackState: "none" | "paused" | "playing";
  setActionHandler: (action: string, handler: (() => void) | null) => void;
  setPositionState?: (state?: {
    duration?: number;
    playbackRate?: number;
    position?: number;
  }) => void;
};

type MediaMetadataCtor = new (init: {
  title?: string;
  artist?: string;
  album?: string;
  artwork?: { src: string; sizes?: string; type?: string }[];
}) => unknown;

function getSession(): MediaSessionLike | null {
  if (!isMediaSessionSupported()) return null;
  const session = (navigator as unknown as { mediaSession?: MediaSessionLike }).mediaSession;
  return session ?? null;
}

function getMetadataCtor(): MediaMetadataCtor | null {
  if (typeof window === "undefined") return null;
  const ctor = (window as unknown as { MediaMetadata?: MediaMetadataCtor }).MediaMetadata;
  return ctor ?? null;
}

/**
 * Push the current track + play state into the OS. Safe to call often; it is a
 * no-op in browsers without Media Session support.
 */
export function syncMediaSession() {
  const session = getSession();
  if (!session) return;

  const state = songPlayer.getState();
  const track = state.queue[state.index];

  // Nothing playing, feature off, or a YouTube track: clear the lock screen so
  // it never shows a control that cannot work.
  if (!state.active || !track || !isBackgroundPlayEnabled() || !canBackgroundPlay(track)) {
    session.metadata = null;
    session.playbackState = "none";
    return;
  }

  const Metadata = getMetadataCtor();
  if (Metadata) {
    const artwork: { src: string; sizes?: string; type?: string }[] = [];
    if (track.coverUrl) {
      artwork.push({ src: track.coverUrl, sizes: "512x512", type: "image/png" });
    }
    session.metadata = new Metadata({
      title: track.title,
      artist: track.artist,
      album: "Coolerup",
      artwork,
    });
  }

  session.playbackState = state.playing ? "playing" : "paused";

  // Lock-screen scrubber. Browsers throw if duration is 0/NaN, so guard it.
  try {
    if (state.duration > 0 && Number.isFinite(state.duration)) {
      session.setPositionState?.({
        duration: state.duration,
        playbackRate: 1,
        position: Math.min(state.time, state.duration),
      });
    }
  } catch {
    /* some browsers reject position updates mid-load — harmless */
  }
}

/** Wire the OS buttons to the shared player. */
function installActionHandlers() {
  const session = getSession();
  if (!session) return;

  const play = () => {
    if (!songPlayer.getState().playing) songPlayer.toggle();
  };
  const pause = () => {
    if (songPlayer.getState().playing) songPlayer.toggle();
  };

  try {
    session.setActionHandler("play", play);
    session.setActionHandler("pause", pause);
    session.setActionHandler("nexttrack", () => songPlayer.next());
    session.setActionHandler("previoustrack", () => songPlayer.prev());
    session.setActionHandler("stop", () => songPlayer.stop());
  } catch {
    /* unsupported action names are ignored by the browser */
  }
}

function clearMediaSession() {
  const session = getSession();
  if (!session) return;
  session.metadata = null;
  session.playbackState = "none";
  for (const action of [
    "play",
    "pause",
    "nexttrack",
    "previoustrack",
    "stop",
    "seekto",
    "seekbackward",
    "seekforward",
  ]) {
    try {
      session.setActionHandler(action, null);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Mount once (the mini player does this). Returns a cleanup function.
 *
 * Also enforces the OFF setting: if the user disables background play, hiding
 * the page pauses the song instead of letting it run.
 */
export function attachBackgroundPlay(): () => void {
  if (typeof window === "undefined") return () => undefined;

  installActionHandlers();
  syncMediaSession();

  const unsubscribe = songPlayer.subscribe(() => syncMediaSession());
  const unsubscribePref = subscribeBackgroundPlay(() => syncMediaSession());

  const onVisibility = () => {
    if (!document.hidden) return;
    // Off, or no VIP plan: hiding the app stops the music.
    if (isBackgroundPlayEnabled()) return;
    const state = songPlayer.getState();
    if (state.playing) songPlayer.toggle();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    unsubscribe();
    unsubscribePref();
    document.removeEventListener("visibilitychange", onVisibility);
    clearMediaSession();
  };
}
