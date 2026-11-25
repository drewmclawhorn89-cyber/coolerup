import { supabase } from "@/integrations/supabase/client";

/**
 * Community guidelines copy shown in the app.
 *
 * Coolerup no longer runs an automated word or media filter. These are the
 * rules people agree to, and reports are reviewed by the owner.
 */
export const RULES = [
  ["No nudity or sexual content", "Keep it clothed. No porn, sexual acts, or sexual solicitation."],
  [
    "No sexual content involving minors",
    "Zero tolerance. Accounts are banned permanently and reported.",
  ],
  ["No harassment or bullying", "Don't target, threaten, or pile on anyone."],
  [
    "No hate",
    "No attacks on anyone for race, religion, gender, sexuality, disability, or where they're from.",
  ],
  ["No violence", "No threats, gore, or encouraging anyone to hurt themselves or others."],
  ["No spam or scams", "No repeated messages, fake giveaways, or shady links."],
] as const;

/* -------------------------------------------------------------------------- */
/*  Reports                                                                   */
/*                                                                            */
/*  Reports are manual only. They are written to the `reports` table for      */
/*  Admin > Reports and immediately emailed to the owner. They never hide     */
/*  content, warn anyone, or ban anyone automatically. The owner reviews      */
/*  every report by hand.                                                     */
/* -------------------------------------------------------------------------- */

/** Report categories requested for Coolerup. Note: `harassment` maps cleanly to the existing DB constraint for Bullying. */
export const REPORT_REASONS = [
  { id: "spam", label: "Spam", hint: "Fake giveaways, repeated posts, shady links" },
  { id: "harassment", label: "Bullying", hint: "Harassment, targeting, or piling on someone" },
  { id: "sexual", label: "Sexual", hint: "Nudity or explicit sexual content" },
  { id: "hate", label: "Hate", hint: "Attacks based on race, religion, gender, or identity" },
  { id: "other", label: "Other", hint: "Something else that breaks community rules" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["id"];

const EXTRA_REASON_LABELS: Record<string, string> = {
  bullying: "Bullying",
  violence: "Violence",
  nudity: "Nudity",
  minor: "Minor safety",
  illegal: "Illegal activity",
  scam: "Scam",
};

export function reasonDisplayLabel(id: string | null | undefined): string {
  if (!id) return "Other";
  const key = id.trim().toLowerCase();
  const match = REPORT_REASONS.find((r) => r.id === key);
  if (match) return match.label;
  return EXTRA_REASON_LABELS[key] ?? id;
}

export type ReportTargetType = "video" | "full_video" | "comment" | "profile" | "message";

export type ReportContext = {
  targetType?: ReportTargetType | undefined;
  commentId?: string | null | undefined;
  targetUrl?: string | null | undefined;
  targetText?: string | null | undefined;
  thumbnailUrl?: string | null | undefined;
  screenshotDataUrl?: string | null | undefined;
  reporterHandle?: string | null | undefined;
};

export type ModerationResult = {
  ok: boolean;
  banned?: boolean | undefined;
  action?: string | null | undefined;
  expires_at?: string | null | undefined;
  duplicate?: boolean | undefined;
  report_count?: number | undefined;
  emailSent?: boolean | undefined;
  error?: string | undefined;
};

const unwrap = <T>(data: unknown): T | null => {
  if (Array.isArray(data)) return (data[0] ?? null) as T | null;
  return (data ?? null) as T | null;
};

/** True when this handle is currently banned (manual admin ban). */
export async function checkIfBanned(username: string): Promise<boolean> {
  const handle = username.replace(/^@+/, "").trim();
  if (!handle) return false;
  try {
    const { data, error } = await supabase.rpc("is_banned_username", { _username: handle });
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

async function getFirebaseTokenIfPresent(): Promise<string | null> {
  try {
    const { getFirebaseAuth } = await import("@/lib/firebase");
    const user = getFirebaseAuth()?.currentUser;
    if (!user) return null;
    return await user.getIdToken();
  } catch {
    return null;
  }
}

async function dispatchInstantReportEmail(params: {
  reportedUsername: string;
  videoId: string | null;
  reason: ReportReason;
  details?: string | undefined;
  context?: ReportContext | undefined;
  skipInsertIfMissing: boolean;
}): Promise<{ ok: boolean; emailSent?: boolean }> {
  const origin = typeof window !== "undefined" ? window.location.origin : null;
  const payload = {
    reportedUsername: params.reportedUsername.replace(/^@+/, "").trim(),
    targetType:
      params.context?.targetType ??
      (params.context?.commentId ? "comment" : params.videoId ? "video" : "profile"),
    videoId: params.videoId,
    commentId: params.context?.commentId ?? null,
    targetUrl: params.context?.targetUrl ?? null,
    targetText: params.context?.targetText ?? null,
    thumbnailUrl: params.context?.thumbnailUrl ?? null,
    screenshotDataUrl: params.context?.screenshotDataUrl ?? null,
    reason: params.reason,
    details: params.details?.trim().slice(0, 1000) || null,
    origin,
    skipInsertIfMissing: params.skipInsertIfMissing,
  };

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (sessionData.session?.access_token) {
      const { submitReportEmail } = await import("@/lib/reports.functions");
      const res = await submitReportEmail({ data: payload });
      return { ok: Boolean(res?.ok), emailSent: Boolean(res?.emailSent) };
    }

    const firebaseToken = await getFirebaseTokenIfPresent();
    if (firebaseToken) {
      const res = await fetch("/api/reports/notify", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${firebaseToken}`,
        },
        body: JSON.stringify({
          ...payload,
          reporterHandle: params.context?.reporterHandle ?? null,
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { ok?: boolean; emailSent?: boolean };
        return { ok: Boolean(body.ok), emailSent: Boolean(body.emailSent) };
      }
    }
  } catch (err) {
    console.warn("[moderation] report email dispatch failed:", err);
  }
  return { ok: false, emailSent: false };
}

/**
 * Report a video, comment, or profile. Inserts the report into Supabase and
 * immediately emails the moderation alert to the app owner server-side.
 *
 * This is the only moderation path left: reports are recorded and emailed,
 * never auto-hidden, auto-warned, or auto-banned.
 */
export async function reportContent(
  videoId: string | null,
  reportedUsername: string,
  reason: ReportReason,
  details?: string,
  context?: ReportContext,
): Promise<ModerationResult> {
  const cleanUser = reportedUsername.replace(/^@+/, "").trim();
  const cleanDetails = details?.trim() ? details.trim().slice(0, 1000) : null;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session?.access_token) {
      const fallback = await dispatchInstantReportEmail({
        reportedUsername: cleanUser,
        videoId,
        reason,
        details: cleanDetails ?? undefined,
        context,
        skipInsertIfMissing: false,
      });
      if (fallback.ok) {
        return { ok: true, emailSent: fallback.emailSent };
      }
      return { ok: false, error: "Sign in to submit a report" };
    }

    const { data, error } = await supabase.rpc("report_content", {
      _video_id: videoId as string,
      _reported_username: cleanUser,
      _reason: reason,
      _details: cleanDetails as string,
    });
    if (error) return { ok: false, error: error.message };
    const row = unwrap<Record<string, unknown>>(data) ?? {};
    const duplicate = Boolean(row["duplicate"]);
    const ok = Boolean(row["ok"]);

    let emailSent = false;
    if (ok && !duplicate) {
      const emailRes = await dispatchInstantReportEmail({
        reportedUsername: cleanUser,
        videoId,
        reason,
        details: cleanDetails ?? undefined,
        context,
        skipInsertIfMissing: false,
      });
      emailSent = Boolean(emailRes.emailSent);
    }

    return {
      ok,
      banned: Boolean(row["banned"]),
      action: (row["action"] as string | undefined) ?? null,
      expires_at: (row["expires_at"] as string | undefined) ?? null,
      duplicate,
      report_count: (row["report_count"] as number | undefined) ?? undefined,
      emailSent,
      error: (row["error"] as string | undefined) ?? undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not send report" };
  }
}

/* ------------------------------- admin ---------------------------------- */

export async function amIAdmin(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("am_i_admin");
    if (error) return false;
    return Boolean(data);
  } catch {
    return false;
  }
}

export async function amIOwner(): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("is_owner");
    if (error) return false;
    return data === true;
  } catch {
    return false;
  }
}

export async function ownerUnban(
  username: string,
): Promise<{ ok: boolean; error?: string | undefined }> {
  try {
    const { data, error } = await supabase.rpc("owner_unban", { p_username: username });
    if (error) return { ok: false, error: error.message };
    const row = (data ?? {}) as { ok?: boolean; error?: string };
    return { ok: Boolean(row.ok), error: row.error };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}

export type AdminReport = {
  id: string;
  video_id: string | null;
  reported_video_id: string | null;
  reporter_username: string;
  reported_username: string;
  reported_user_id: string | null;
  reason: string;
  details: string | null;
  status: string;
  action_taken: string | null;
  target_type?: string | null | undefined;
  comment_id?: string | null | undefined;
  target_url?: string | null | undefined;
  target_text?: string | null | undefined;
  thumbnail_url?: string | null | undefined;
  email_sent?: boolean | undefined;
  email_error?: string | null | undefined;
  emailed_at?: string | null | undefined;
  created_at: string;
};

export type AdminBan = {
  id: string;
  username: string;
  user_id: string | null;
  reason: string | null;
  banned_by: string | null;
  kind: string;
  is_permanent: boolean;
  expires_at: string | null;
  auto: boolean;
  report_count: number | null;
  created_at: string;
  active: boolean;
};

export type ModerationLogRow = {
  id: string;
  username: string | null;
  action: string;
  reason: string | null;
  report_count: number | null;
  is_permanent: boolean;
  expires_at: string | null;
  auto: boolean;
  actor: string | null;
  created_at: string;
};

export async function adminReports(limit = 100): Promise<AdminReport[]> {
  try {
    const { adminFetchReportsServer } = await import("@/lib/reports.functions");
    const serverRows = await adminFetchReportsServer({ data: { limit } });
    if (Array.isArray(serverRows)) {
      return serverRows as unknown as AdminReport[];
    }
  } catch {
    // Fall back to direct Supabase RPC below when running without server session.
  }

  const { data, error } = await supabase.rpc("admin_reports", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as AdminReport[];
}

export async function adminBans(): Promise<AdminBan[]> {
  const { data, error } = await supabase.rpc("admin_bans");
  if (error) throw error;
  return (data ?? []) as AdminBan[];
}

export async function adminModerationLog(limit = 100): Promise<ModerationLogRow[]> {
  const { data, error } = await supabase.rpc("admin_moderation_log", { _limit: limit });
  if (error) throw error;
  return (data ?? []) as ModerationLogRow[];
}

export async function adminBan(
  username: string,
  hours: number | null,
  permanent: boolean,
  reason = "Manual ban by admin",
): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_ban", {
    _username: username.replace(/^@+/, "").trim(),
    _hours: hours as number,
    _permanent: permanent,
    _reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  const row = unwrap<Record<string, unknown>>(data) ?? {};
  return {
    ok: Boolean(row["ok"]),
    banned: Boolean(row["applied"]),
    error: row["error"] as string | undefined,
  };
}

export async function adminUnban(username: string): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_unban", {
    _username: username.replace(/^@+/, "").trim(),
  });
  if (error) return { ok: false, error: error.message };
  const row = unwrap<Record<string, unknown>>(data) ?? {};
  return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
}

export async function adminDismissReport(reportId: string): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_dismiss_report", { _report_id: reportId });
  if (!error) {
    const row = unwrap<Record<string, unknown>>(data) ?? {};
    return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
  }
  try {
    const { adminModerateReportAction } = await import("@/lib/reports.functions");
    return await adminModerateReportAction({ data: { action: "dismiss", reportId } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : error.message };
  }
}

export async function adminDeleteReportedPost(reportId: string): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc(
    "admin_delete_reported_post" as never,
    {
      _report_id: reportId,
    } as never,
  );
  if (!error) {
    const row = unwrap<Record<string, unknown>>(data) ?? {};
    return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
  }
  try {
    const { adminModerateReportAction } = await import("@/lib/reports.functions");
    return await adminModerateReportAction({ data: { action: "delete_post", reportId } });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : error.message };
  }
}

export async function adminBanReportedUser(
  reportId: string,
  hours: number | null,
  permanent: boolean,
  reason?: string,
): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc(
    "admin_ban_for_report" as never,
    {
      _report_id: reportId,
      _hours: hours,
      _permanent: permanent,
      _reason: reason ?? null,
    } as never,
  );
  if (!error) {
    const row = unwrap<Record<string, unknown>>(data) ?? {};
    return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
  }
  try {
    const { adminModerateReportAction } = await import("@/lib/reports.functions");
    return await adminModerateReportAction({
      data: { action: "ban_user", reportId, hours, permanent, reason },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : error.message };
  }
}

export async function adminUnhideVideo(videoId: string): Promise<ModerationResult> {
  const { data, error } = await supabase.rpc("admin_unhide_video", { _video_id: videoId });
  if (error) return { ok: false, error: error.message };
  const row = unwrap<Record<string, unknown>>(data) ?? {};
  return { ok: Boolean(row["ok"]), error: row["error"] as string | undefined };
}
