/**
 * YouTube audio backend
 * ---------------------
 * YouTube songs used to play from an `<iframe>` rendered inside the Music tab.
 * That had two problems:
 *
 * 1. Leaving the Music tab unmounted the iframe, so the song died with the
 *    route change.
 * 2. YouTube's player pauses itself the moment the page is hidden, which made
 *    background play impossible.
 *
 * This module owns ONE hidden player for the whole app. It lives in a container
 * appended to `<body>` (never `display:none` \u2014 YouTube refuses to play inside a
 * hidden element), so it survives route changes, and `@/lib/backgroundPlay`
 * spoofs the Page Visibility API while the listener is entitled, which is what
 * stops YouTube from pausing itself when the app goes to the background.
 *
 * `@/lib/songPlayer` treats this as a second backend: a track with
 * `source: "youtube"` is routed here instead of into the shared
 * `<audio>` element, so the queue, the mini player and the lock-screen controls
 * all work the same way for both kinds of song.
 */

/** Minimal shape of the bits of the IFrame API we actually use. */
type YTPlayerLike = {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead?: boolean) => void;
  setVolume: (volume: number) => void;
  getCurrentTime: () => number;
  getDuration: () => number;
  loadVideoById: (videoId: string) => void;
  destroy: () => void;
};

type YTNamespace = {
  Player: new (
    element: HTMLElement | string,
    options: {
      videoId?: string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onStateChange?: (event: { data: number }) => void;
        onError?: () => void;
      };
    },
  ) => YTPlayerLike;
};

/** YouTube player state codes. */
const YT_PLAYING = 1;
const YT_PAUSED = 2;
const YT_BUFFERING = 3;
const YT_ENDED = 0;

export type YouTubeAudioEvents = {
  /** Fired roughly twice a second while a video is loaded. */
  onProgress?: (time: number, duration: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  onLoadingChange?: (loading: boolean) => void;
  onEnded?: () => void;
  onError?: (message: string) => void;
};

let listeners: YouTubeAudioEvents = {};

/** Swap in the callbacks for whoever is driving playback (the song player). */
export function setYouTubeAudioListeners(next: YouTubeAudioEvents) {
  listeners = next;
}

let host: HTMLDivElement | null = null;
let player: YTPlayerLike | null = null;
let apiPromise: Promise<YTNamespace> | null = null;
let pollTimer = 0;
let ready = false;
let currentVideoId = "";
let pendingAutoplay = false;
let pendingSeek: number | null = null;
let volume = 90;

/** The API script is global \u2014 load it once for the whole session. */
function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === "undefined") return Promise.reject(new Error("No browser"));
  const w = window as unknown as { YT?: YTNamespace; onYouTubeIframeAPIReady?: () => void };
  if (w.YT?.Player) return Promise.resolve(w.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    const previous = w.onYouTubeIframeAPIReady;
    w.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (w.YT) resolve(w.YT);
      else reject(new Error("YouTube player unavailable"));
    };
    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Couldn't load the YouTube player."));
    document.head.appendChild(script);
  });
  return apiPromise;
}

/**
 * The off-screen container the player renders into.
 *
 * Kept 1x1 and almost transparent instead of `display:none` / `visibility:
 * hidden`, because YouTube checks whether its element is actually rendered and
 * refuses to play if it is not.
 */
function ensureHost(): HTMLDivElement {
  if (host && host.isConnected) return host;
  const el = document.createElement("div");
  el.id = "coolerup-youtube-audio";
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = [
    "position:fixed",
    "left:0",
    "bottom:0",
    "width:1px",
    "height:1px",
    "opacity:0.01",
    "pointer-events:none",
    "overflow:hidden",
    "z-index:-1",
  ].join(";");
  const inner = document.createElement("div");
  inner.id = "coolerup-youtube-audio-inner";
  el.appendChild(inner);
  document.body.appendChild(el);
  host = el;
  return el;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(() => {
    const p = player;
    if (!p) return;
    try {
      const t = p.getCurrentTime();
      const d = p.getDuration();
      listeners.onProgress?.(Number.isFinite(t) ? t : 0, Number.isFinite(d) && d > 0 ? d : 0);
    } catch {
      /* player torn down between ticks */
    }
  }, 500);
}

function stopPolling() {
  if (!pollTimer) return;
  window.clearInterval(pollTimer);
  pollTimer = 0;
}

function createPlayer(YT: YTNamespace, videoId: string) {
  const inner = ensureHost().firstElementChild as HTMLDivElement;
  player = new YT.Player(inner, {
    videoId,
    playerVars: {
      autoplay: 1,
      playsinline: 1,
      controls: 0,
      disablekb: 1,
      modestbranding: 1,
      rel: 0,
      iv_load_policy: 3,
      enablejsapi: 1,
      origin: window.location.origin,
    },
    events: {
      onReady: () => {
        ready = true;
        player?.setVolume(volume);
        if (pendingSeek !== null) {
          player?.seekTo(pendingSeek, true);
          pendingSeek = null;
        }
        if (pendingAutoplay) {
          pendingAutoplay = false;
          player?.playVideo();
        }
        startPolling();
      },
      onStateChange: (event) => {
        const state = event.data;
        if (state === YT_PLAYING) {
          listeners.onPlayingChange?.(true);
          listeners.onLoadingChange?.(false);
        } else if (state === YT_PAUSED) {
          listeners.onPlayingChange?.(false);
        } else if (state === YT_BUFFERING) {
          listeners.onLoadingChange?.(true);
        } else if (state === YT_ENDED) {
          listeners.onPlayingChange?.(false);
          listeners.onEnded?.();
        }
      },
      onError: () => {
        listeners.onLoadingChange?.(false);
        listeners.onPlayingChange?.(false);
        listeners.onError?.("This YouTube song can't be played here. Try another.");
      },
    },
  });
}

/**
 * Load a video and start it.
 *
 * The player is created lazily on the first song \u2014 which always happens inside a
 * tap, so the browser's autoplay policy is satisfied \u2014 and reused afterwards.
 */
export async function loadYouTubeAudio(videoId: string, autoplay = true): Promise<void> {
  if (!videoId) return;
  pendingAutoplay = autoplay;
  pendingSeek = null;

  if (player && ready) {
    if (currentVideoId !== videoId) {
      currentVideoId = videoId;
      try {
        player.loadVideoById(videoId);
      } catch {
        /* player mid-teardown; nothing more to do */
      }
      if (autoplay) player.playVideo();
    } else if (autoplay) {
      player.playVideo();
    }
    startPolling();
    return;
  }

  currentVideoId = videoId;
  const YT = await loadYouTubeApi();
  if (player) {
    // A player exists but never became ready \u2014 rebuild it once.
    try {
      player.destroy();
    } catch {
      /* already gone */
    }
    player = null;
    ready = false;
  }
  createPlayer(YT, videoId);
}

export function playYouTubeAudio() {
  if (!player) {
    if (currentVideoId) void loadYouTubeAudio(currentVideoId, true);
    return;
  }
  try {
    player.playVideo();
  } catch {
    /* ignore */
  }
}

export function pauseYouTubeAudio() {
  try {
    player?.pauseVideo();
  } catch {
    /* ignore */
  }
}

export function seekYouTubeAudio(seconds: number) {
  if (!player || !ready) {
    pendingSeek = seconds;
    return;
  }
  try {
    player.seekTo(seconds, true);
  } catch {
    /* ignore */
  }
}

/** Volume is 0-100 here; the song player speaks 0-1. */
export function setYouTubeVolume(percent: number) {
  volume = Math.max(0, Math.min(100, Math.round(percent)));
  try {
    player?.setVolume(volume);
  } catch {
    /* ignore */
  }
}

/** Stop playback and forget the loaded video. */
export function stopYouTubeAudio() {
  stopPolling();
  try {
    player?.pauseVideo();
  } catch {
    /* ignore */
  }
  currentVideoId = "";
  pendingAutoplay = false;
  pendingSeek = null;
}

/** True once the hidden player is ready to accept commands. */
export function isYouTubeAudioReady() {
  return Boolean(player && ready);
}

/** The video currently loaded in the hidden player, if any. */
export function currentYouTubeVideoId() {
  return currentVideoId;
}

/** Tear the player down entirely (tests / hot reload). */
export function destroyYouTubeAudio() {
  stopPolling();
  try {
    player?.destroy();
  } catch {
    /* ignore */
  }
  player = null;
  ready = false;
  currentVideoId = "";
  host?.remove();
  host = null;
  apiPromise = null;
}
