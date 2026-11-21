/**
 * Client-side nudge for the TikTok ingestion job.
 *
 * The job is supposed to be driven by a scheduler hitting
 * `/api/tiktok/sync` with `LOVABLE_CRON_SECRET`. When that secret is not
 * configured there is no scheduler at all, so nothing ever runs and the
 * library stays empty no matter how many sources an admin adds.
 *
 * This module closes that gap: every app load quietly asks
 * `/api/tiktok/heartbeat`, which is unauthenticated on purpose. It cannot be
 * abused into extra work — `tiktok_claim_run()` in Postgres holds an advisory
 * lock and refuses to start a run more often than `interval_minutes`, so the
 * endpoint is really just a "is it time yet?" question.
 *
 * Two throttles keep it polite:
 *   - localStorage remembers the last ping across tabs and reloads;
 *   - the route itself throttles per server instance.
 *
 * It is fire-and-forget and swallows every error. Ingestion must never break
 * page rendering, and a failed ping is not something a user can act on.
 */

const STORAGE_KEY = "coolerup:tiktok-heartbeat-at";

/** Minimum gap between pings from this browser. */
const CLIENT_WINDOW_MS = 10 * 60_000;

function recentlyPinged(): boolean {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const at = Number.parseInt(raw, 10);
    if (!Number.isFinite(at)) return false;
    return Date.now() - at < CLIENT_WINDOW_MS;
  } catch {
    // Private mode / storage disabled: just ping, the server throttles anyway.
    return false;
  }
}

function rememberPing(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — nothing to remember, nothing to fix */
  }
}

/**
 * Ask the server to run the TikTok sync if it is due.
 *
 * Returns nothing and never throws. Call it once from the app root, after
 * hydration, so it does not compete with first paint.
 */
export function pingTikTokSync(): void {
  if (typeof window === "undefined") return;
  if (recentlyPinged()) return;

  rememberPing();

  // `keepalive` lets the request finish even if the user navigates away.
  void fetch("/api/tiktok/heartbeat", {
    method: "GET",
    headers: { accept: "application/json" },
    keepalive: true,
  }).catch(() => {
    /* offline, blocked, or server down — the next load tries again */
  });
}
