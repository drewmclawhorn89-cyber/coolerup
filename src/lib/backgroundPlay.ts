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
 * YouTube songs play through a hidden IFrame player (see `@/lib/youtubeAudio`).
 * That player pauses itself whenever it thinks the page is hidden, so while a
 * VIP listener has background play on we spoof the Page Visibility API
 * (`document.hidden` / `document.visibilityState`). YouTube's own script then
 * keeps playing instead of pausing itself. The spoof is only ever active while
 * the perk is live and a YouTube song is playing, and it is removed the moment
 * either stops being true.
 *
 * iOS is still the exception: Safari suspends backgrounded pages outright, so
 * no web audio of any kind survives there. We say so instead of pretending.
 *
 * Background play is a VIP perk. `setBackgroundPlayEntitled` is called by the
 * app whenever the signed-in user's plan changes; while it is false the feature
 * is off no matter what the stored preference says, and losing the entitlement
 * pauses whatever is playing right away. The preference is kept so a returning
 * VIP finds the toggle exactly where they left it.
 */

/** localStorage key (stored as `settings:background-play`). */
export const BACKGROUND_PLAY_KEY = "background-play";

/**
 * Shown wherever a YouTube-backed song is playing.
 *
 * YouTube used to be a hard "no" for background play. It now works on browsers
 * that keep background pages alive (Chrome, Edge, Android), but iOS suspends
 * backgrounded web pages entirely, so the honest warning is device-specific.
 */
export const YOUTUBE_BACKGROUND_WARNING =
  "YouTube songs now keep playing in the background on Chrome, Edge and Android. iPhone and iPad still pause them — iOS suspends background web audio.";

/** Short version for the compact mini player. */
export const YOUTUBE_BACKGROUND_SHORT = "May pause on iPhone/iPad";

/** Shown next to the toggle in Settings. */
export const BACKGROUND_PLAY_HELP =
  "Keep music playing when you switch tabs, lock your phone, or open another app. Works with your own MP3s, royalty-free songs, downloaded songs and YouTube songs (iPhone/iPad may still pause YouTube).";

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
  syncVisibilitySpoof();
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
  syncVisibilitySpoof();
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

/**
 * True when the track can keep playing with the screen off.
 *
 * YouTube songs count now: the hidden player keeps decoding and the visibility
 * spoof below stops YouTube from pausing itself. iOS still suspends the page,
 * which is a platform limit rather than a track limit.
 */
export function canBackgroundPlay(track: PlayerTrack | null | undefined): boolean {
  if (!track) return false;
  return Boolean(track.url || track.youtubeUrl || track.source === "youtube");
}

/** True when this track streams from YouTube rather than a real audio file. */
export function isYouTubeTrack(track: PlayerTrack | null | undefined): boolean {
  return track?.source === "youtube";
}

/* -------------------------------------------------------------------------- */
/*  Page Visibility spoof                                                     */
/* -------------------------------------------------------------------------- */

/**
 * YouTube's player listens for `visibilitychange` and pauses itself. Convincing
 * it the page is still visible is the only way to keep a YouTube song going in
 * the background, so while the perk is live we redefine the visibility getters
 * on the `document` instance. `Document.prototype` is left untouched, so the
 * real values are still reachable — which is what our own enforcement uses.
 */
let spoofInstalled = false;

function realHidden(): boolean {
  if (typeof document === "undefined") return false;
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "hidden");
  if (desc?.get) return Boolean(desc.get.call(document));
  return Boolean(document.hidden);
}

function realVisibilityState(): DocumentVisibilityState {
  if (typeof document === "undefined") return "visible";
  const desc = Object.getOwnPropertyDescriptor(Document.prototype, "visibilityState");
  if (desc?.get) return desc.get.call(document) as DocumentVisibilityState;
  return document.visibilityState;
}

/** Pretend the page is visible so YouTube keeps playing. */
export function installVisibilitySpoof() {
  if (spoofInstalled || typeof document === "undefined") return;
  spoofInstalled = true;
  try {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible" as DocumentVisibilityState,
    });
    // Also cover the old webkit-prefixed getters some embedded scripts read.
    Object.defineProperty(document, "webkitHidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "webkitVisibilityState", {
      configurable: true,
      get: () => "visible",
    });
  } catch {
    /* some browsers refuse to redefine these — playback still works in-tab */
  }
}

/** Put the real Page Visibility values back. */
export function removeVisibilitySpoof() {
  if (!spoofInstalled || typeof document === "undefined") return;
  spoofInstalled = false;
  for (const key of ["hidden", "visibilityState", "webkitHidden", "webkitVisibilityState"]) {
    try {
      delete (document as unknown as Record<string, unknown>)[key];
    } catch {
      /* ignore */
    }
  }
}

/** True while the spoof is in place (tests + diagnostics). */
export function isVisibilitySpoofed() {
  return spoofInstalled;
}

/**
 * Decide whether the spoof should be on right now: perk live, toggle on, and a
 * YouTube song actually playing. Called from the player subscription and from
 * the entitlement/preference setters.
 */
export function syncVisibilitySpoof() {
  const state = songPlayer.getState();
  const track = state.queue[state.index];
  const shouldSpoof = entitled && prefEnabled() && state.playing && isYouTubeTrack(track);
  if (shouldSpoof) installVisibilitySpoof();
  else removeVisibilitySpoof();
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

  // Nothing playing, or the perk is off: clear the lock screen so it never
  // shows a control that cannot work.
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
  syncVisibilitySpoof();

  const unsubscribe = songPlayer.subscribe(() => {
    syncMediaSession();
    syncVisibilitySpoof();
  });
  const unsubscribePref = subscribeBackgroundPlay(() => {
    syncMediaSession();
    syncVisibilitySpoof();
  });

  const onVisibility = () => {
    // Read the *real* visibility: the spoof above makes document.hidden lie.
    if (!realHidden()) {
      syncVisibilitySpoof();
      return;
    }
    // Off, or no VIP plan: hiding the app stops the music.
    if (isBackgroundPlayEnabled()) {
      syncVisibilitySpoof();
      return;
    }
    const state = songPlayer.getState();
    if (state.playing) songPlayer.toggle();
  };
  document.addEventListener("visibilitychange", onVisibility);

  return () => {
    unsubscribe();
    unsubscribePref();
    document.removeEventListener("visibilitychange", onVisibility);
    removeVisibilitySpoof();
    clearMediaSession();
  };
}
