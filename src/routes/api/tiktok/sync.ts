import { createFileRoute } from "@tanstack/react-router";
import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { runTikTokSync } from "@/lib/tiktokSync.server";

/**
 * The 24/7 TikTok pull.
 *
 * Point a scheduler at this URL (Cloudflare Cron Trigger, GitHub Actions, or
 * Lovable's cron) with `Authorization: Bearer $LOVABLE_CRON_SECRET`. The route
 * itself is idempotent and safe to call every minute: `tiktok_claim_run()`
 * refuses a run when one is already in flight or the configured interval has
 * not elapsed, so the real cadence is decided in the admin panel, not by how
 * often the scheduler fires.
 *
 * POST and GET are both accepted because schedulers disagree about which verb
 * to use; both are authenticated the same way.
 */
async function handle(request: Request): Promise<Response> {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;

  try {
    const summary = await runTikTokSync({ trigger: "cron" });
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

export const Route = createFileRoute("/api/tiktok/sync")({
  server: {
    handlers: {
      GET: ({ request }) => handle(request),
      POST: ({ request }) => handle(request),
    },
  },
});
