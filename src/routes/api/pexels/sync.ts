import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { runPexelsSync } from "@/lib/pexelsSync.server";

/**
 * The 24/7 licensed-video pull.
 *
 * Point a scheduler here with `Authorization: Bearer $LOVABLE_CRON_SECRET`.
 * Safe to call every minute: `pexels_claim_run()` refuses to start when a run
 * is in flight or the configured interval has not elapsed, so the real cadence
 * is decided in the database, not by the scheduler.
 *
 * GET and POST are both accepted because schedulers disagree about verbs.
 */
async function handle(request: Request): Promise<Response> {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;

  try {
    const summary = await runPexelsSync({ trigger: "cron" });
    return Response.json(summary, {
      status: summary.status === "error" ? 500 : 200,
      headers: { "cache-control": "no-store" },
    });
  } catch (err) {
    return Response.json(
      {
        status: "error",
        message: err instanceof Error ? err.message : "Unexpected sync failure.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}

export const Route = createFileRoute("/api/pexels/sync")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
