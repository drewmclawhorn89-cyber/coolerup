/**
 * Read a YouTube video's length in the browser, using YouTube's own IFrame
 * player API.
 *
 * Why not ask the server? YouTube rate-limits datacenter IPs hard: a fetch of
 * the watch page from a serverless function usually comes back 429 or a bot
 * check, so the length is simply missing. The viewer's browser, on the other
 * hand, loads the official player every day without complaint — so we spin up
 * a 1x1, off-screen player, ask it `getDuration()` once it is ready, and throw
 * it away. The result is then persisted server-side, so this only ever happens
 * for a video nobody has looked up before.
 */

type YouTubePlayer = {
  getDuration?: () => number;
  destroy?: () => void;
};

type YouTubeApi = {
  Player: new (
    element: HTMLElement,
    options: {
      videoId: string;
      width?: number | string;
      height?: number | string;
      playerVars?: Record<string, string | number>;
      events?: {
        onReady?: () => void;
        onError?: () => void;
      };
    },
  ) => YouTubePlayer;
};

type YouTubeWindow = Window & {
  YT?: YouTubeApi;
  onYouTubeIframeAPIReady?: () => void;
};

let apiPromise: Promise<YouTubeApi> | null = null;

/** Inject https://www.youtube.com/iframe_api exactly once per page load. */
function loadPlayerApi(): Promise<YouTubeApi> {
  const scope = window as YouTubeWindow;
  if (scope.YT?.Player) return Promise.resolve(scope.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    const previous = scope.onYouTubeIframeAPIReady;
    scope.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (scope.YT?.Player) resolve(scope.YT);
      else reject(new Error("YouTube player API did not initialise"));
    };

    const script = document.createElement("script");
    script.src = "https://www.youtube.com/iframe_api";
    script.async = true;
    script.onerror = () => reject(new Error("Could not load the YouTube player"));
    document.head.appendChild(script);

    // Never leave the grid waiting on a blocked script.
    window.setTimeout(() => reject(new Error("YouTube player timed out")), 15_000);
  }).catch((error: unknown) => {
    apiPromise = null;
    throw error;
  });

  return apiPromise;
}

/**
 * Ask the player for one video's length. Resolves `null` for live streams,
 * private/region-locked videos and anything that never becomes ready.
 */
export async function probeYouTubeDuration(id: string): Promise<number | null> {
  if (typeof window === "undefined" || typeof document === "undefined") return null;

  let api: YouTubeApi;
  try {
    api = await loadPlayerApi();
  } catch {
    return null;
  }

  // The player replaces its target element with an iframe, so wrap it.
  const frame = document.createElement("div");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none";
  const target = document.createElement("div");
  frame.appendChild(target);
  document.body.appendChild(frame);

  return new Promise<number | null>((resolve) => {
    let player: YouTubePlayer | undefined;
    let settled = false;
    let poll: number | undefined;

    const finish = (seconds: number | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(deadline);
      if (poll) window.clearInterval(poll);
      try {
        player?.destroy?.();
      } catch {
        // Already gone.
      }
      frame.remove();
      resolve(seconds && seconds > 0 ? seconds : null);
    };

    const deadline = window.setTimeout(() => finish(null), 12_000);

    try {
      player = new api.Player(target, {
        videoId: id,
        width: 1,
        height: 1,
        playerVars: {
          autoplay: 0,
          controls: 0,
          disablekb: 1,
          playsinline: 1,
          rel: 0,
          origin: window.location.origin,
        },
        events: {
          onReady: () => {
            // `getDuration()` is occasionally 0 for a beat after ready.
            const read = () => {
              const seconds = Math.round(Number(player?.getDuration?.() ?? 0));
              if (seconds > 0) finish(seconds);
            };
            read();
            poll = window.setInterval(read, 400);
          },
          onError: () => finish(null),
        },
      });
    } catch {
      finish(null);
    }
  });
}

/**
 * Probe a handful of ids one at a time — sequential on purpose, so a grid with
 * ten unknown YouTube cards doesn't spawn ten simultaneous players.
 */
export async function probeYouTubeDurations(ids: string[]): Promise<Record<string, number>> {
  const found: Record<string, number> = {};
  for (const id of ids) {
    const seconds = await probeYouTubeDuration(id);
    if (seconds) found[id] = seconds;
  }
  return found;
}
