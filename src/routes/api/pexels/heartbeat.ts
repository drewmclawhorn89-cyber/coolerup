import { createFileRoute } from "@tanstack/react-router";
import { runPexelsSync } from "@/lib/pexelsSync.server";

/**
 * Traffic-driven fallback for deployments with no scheduler.
 *
 * Same contract as the TikTok heartbeat: the caller can only ask "is a run
 * due?", and the answer is decided by `pexels_claim_run()` in Postgres. A
 * stranger cannot increase the cadence, because the interval guard lives in
 * the database.
 *
 * A per-instance throttle keeps a burst of page loads down to one database
 * round trip per minute.
 */

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
    Response.json(body, { status, headers: { "cache-control": "no-store" } });

  if (probe) {
    const configured = Boolean(process.env["PEXELS_API_KEY"]?.trim());
    return json({
      ok: true,
      status: "probe",
      message: configured
        ? "PEXELS_API_KEY is present — ingestion can run."
        : "PEXELS_API_KEY is not set — ingestion will report no_api_key until it is.",
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
    const summary = await runPexelsSync({ trigger: "cron" });
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

export const Route = createFileRoute("/api/pexels/heartbeat")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
    },
  },
});
