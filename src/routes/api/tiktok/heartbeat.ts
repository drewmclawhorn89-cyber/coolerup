import { createFileRoute } from "@tanstack/react-router";
import { runTikTokSync } from "@/lib/tiktokSync.server";

/**
 * The "no cron secret" heartbeat.
 *
 * `LOVABLE_CRON_SECRET` is optional infrastructure: if it is not set, the
 * authenticated `/api/tiktok/sync` route can only ever answer 500, which means
 * the 24/7 loop silently never runs. This route exists so ingestion still
 * happens on a deployment that has no scheduler and no secret configured.
 *
 * Safety comes from the database, not from the caller. Every request funnels
 * through `tiktok_claim_run()`, which takes a transaction-scoped advisory lock
 * and refuses to insert a run row when one is already in flight or when the
 * configured `interval_minutes` has not elapsed. So the worst a stranger can
 * do is ask "is it time yet?" and be told no — they cannot make the job run
 * more often than an admin configured.
 *
 * Two extra brakes sit in front of that:
 *   - a per-instance in-memory throttle, so a flood of page loads costs one
 *     database round trip per minute rather than one per request;
 *   - `?probe=1` returns the current state without attempting a run at all,
 *     which is what the admin panel uses to show "last run / next run".
 *
 * Deliberately GET-only and side-effect-free from the caller's point of view:
 * it is safe to fire from a `fetch()` on page load with no credentials.
 */

/** How often this server instance will even try, regardless of the caller. */
const ATTEMPT_WINDOW_MS = 60_000;

let lastAttemptAt = 0;
let inFlight = false;

type HeartbeatResult = {
  ok: boolean;
  status: "ok" | "partial" | "error" | "skipped" | "busy" | "probe";
  message: string;
  videosAdded?: number;
  sourcesChecked?: number;
};

async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const probe = url.searchParams.get("probe") === "1";

  const json = (body: HeartbeatResult, status = 200) =>
    Response.json(body, {
      status,
      headers: { "cache-control": "no-store" },
    });

  if (probe) {
    // Cheap read-only path: report whether the tables are even there, so a
    // half-applied migration is visible instead of looking like "no videos".
    const { tiktokDiscoveryStatus } = await import("@/lib/tiktok.server");
    const discovery = await tiktokDiscoveryStatus();
    return json({
      ok: true,
      status: "probe",
      message: discovery.displayApi
        ? "Display API token present — creator discovery is available."
        : "No TikTok access token — single-video sources work, creator discovery will report a reason.",
    });
  }

  const now = Date.now();
  if (inFlight) {
    return json({ ok: true, status: "busy", message: "A sync is already running." });
  }
  if (now - lastAttemptAt < ATTEMPT_WINDOW_MS) {
    return json({
      ok: true,
      status: "skipped",
      message: "Checked recently — the database decides the real cadence.",
    });
  }

  lastAttemptAt = now;
  inFlight = true;
  try {
    const summary = await runTikTokSync({ trigger: "cron" });
    return json(
      {
        ok: summary.status !== "error",
        status: summary.status,
        message: summary.message,
        videosAdded: summary.videosAdded,
        sourcesChecked: summary.sourcesChecked,
      },
      summary.status === "error" ? 500 : 200,
    );
  } catch (err) {
    return json(
      {
        ok: false,
        status: "error",
        message: err instanceof Error ? err.message : "Unexpected sync failure.",
      },
      500,
    );
  } finally {
    inFlight = false;
  }
}

export const Route = createFileRoute("/api/tiktok/heartbeat")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
