import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ReportTargetKind } from "./reportEmail.server";

export type SubmitReportEmailPayload = {
  reportedUsername: string;
  targetType?: ReportTargetKind | undefined;
  videoId?: string | null | undefined;
  commentId?: string | null | undefined;
  targetUrl?: string | null | undefined;
  targetText?: string | null | undefined;
  thumbnailUrl?: string | null | undefined;
  screenshotDataUrl?: string | null | undefined;
  reason: string;
  details?: string | null | undefined;
  origin?: string | null | undefined;
  skipInsertIfMissing?: boolean | undefined;
};

/**
 * Authenticated server function invoked immediately after a report is filed.
 * Sends the report notification strictly to the app owner server-side.
 */
export const submitReportEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: SubmitReportEmailPayload) => data)
  .handler(async ({ data, context }) => {
    const { processAndEmailReport } = await import("./reportEmail.server");
    return processAndEmailReport({
      reporterUserId: context.userId,
      reportedUsername: data.reportedUsername,
      targetType: data.targetType,
      videoId: data.videoId ?? null,
      commentId: data.commentId ?? null,
      targetUrl: data.targetUrl ?? null,
      targetText: data.targetText ?? null,
      thumbnailUrl: data.thumbnailUrl ?? null,
      screenshotDataUrl: data.screenshotDataUrl ?? null,
      reason: data.reason,
      details: data.details ?? null,
      origin: data.origin ?? null,
      skipInsertIfMissing: data.skipInsertIfMissing ?? true,
    });
  });

export const adminFetchReportsServer = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number } | undefined) => data ?? {})
  .handler(async ({ data, context }) => {
    const { verifyAdminUser, adminListReportsServer } = await import("./reportEmail.server");
    const check = await verifyAdminUser(context.userId);
    if (!check.ok) throw new Error("Admins only");
    return adminListReportsServer(data.limit ?? 150);
  });

export const adminModerateReportAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      action: "delete_post" | "ban_user" | "dismiss";
      reportId: string;
      hours?: number | null | undefined;
      permanent?: boolean | undefined;
      reason?: string | null | undefined;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    const { verifyAdminUser, adminDeletePostServer, adminBanForReportServer } =
      await import("./reportEmail.server");

    const check = await verifyAdminUser(context.userId);
    if (!check.ok) return { ok: false, error: "Admins only" };

    if (data.action === "delete_post") {
      return adminDeletePostServer(context.userId, data.reportId);
    }
    if (data.action === "ban_user") {
      return adminBanForReportServer(
        context.userId,
        data.reportId,
        data.hours ?? null,
        data.permanent ?? true,
        data.reason,
      );
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("reports")
      .update({ status: "dismissed", action_taken: "dismissed" })
      .eq("id", data.reportId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });
