import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { resolveSupabaseUrl } from "@/integrations/supabase/project";

/**
 * Owner moderation inbox. Lives strictly in server-only modules so reporters
 * never see, select, or override the destination email address.
 */
export const OWNER_REPORT_EMAIL = "coolerup47@gmail.com";

export type ReportTargetKind = "video" | "full_video" | "comment" | "profile" | "message";

export type ProcessReportEmailInput = {
  reporterUserId: string;
  reporterHandle?: string | null | undefined;
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
  createdAt?: string | undefined;
  origin?: string | null | undefined;
  /** Optional DB write override when caller already created the report via RPC. */
  skipInsertIfMissing?: boolean | undefined;
};

export type BuiltReportEmail = {
  to: typeof OWNER_REPORT_EMAIL;
  subject: string;
  html: string;
  text: string;
  attachment: {
    base64: string;
    filename: string;
    contentType: string;
    contentId: string;
  } | null;
};

type ResolvedEmailTransport = {
  resendApiKey: string;
  sendgridApiKey: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
  webhookUrl: string;
};

const REASON_LABELS: Record<string, string> = {
  spam: "Spam",
  bullying: "Bullying",
  harassment: "Bullying",
  sexual: "Sexual",
  hate: "Hate",
  other: "Other",
  violence: "Violence",
  nudity: "Nudity",
  minor: "Minor safety",
  illegal: "Illegal activity",
  scam: "Scam",
};

const TARGET_LABELS: Record<ReportTargetKind, string> = {
  video: "Video",
  full_video: "Full Video",
  comment: "Comment",
  profile: "Profile",
  message: "Direct Message",
};

function dbAdmin(): SupabaseClient {
  return supabaseAdmin as unknown as SupabaseClient;
}

export function formatReportReasonLabel(reason: string): string {
  const key = reason.trim().toLowerCase();
  return REASON_LABELS[key] ?? (reason || "Other");
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function cleanHandle(raw: string | null | undefined): string {
  return (raw ?? "").replace(/^@+/, "").trim();
}

function cleanHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  return null;
}

function parseScreenshotDataUrl(
  dataUrl: string | null | undefined,
): BuiltReportEmail["attachment"] {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match?.[1] || !match[2]) return null;
  const rawMime = match[1].toLowerCase();
  const contentType = rawMime === "image/jpg" ? "image/jpeg" : rawMime;
  const base64 = match[2];
  // Reject oversized images (> 400KB encoded) so mail providers never reject the call.
  if (base64.length > 550_000) return null;
  const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
  return {
    base64,
    filename: `report-screenshot.${ext}`,
    contentType,
    contentId: "report-screenshot",
  };
}

export function buildReportEmailContent(params: {
  reporterUsername: string;
  reportedUsername: string;
  targetType: ReportTargetKind;
  targetUrl: string | null;
  targetText: string | null;
  reason: string;
  details: string | null;
  timestampIso: string;
  thumbnailUrl: string | null;
  screenshotDataUrl?: string | null | undefined;
}): BuiltReportEmail {
  const reporter = cleanHandle(params.reporterUsername) || "unknown";
  const reported = cleanHandle(params.reportedUsername) || "unknown";
  const reasonText = formatReportReasonLabel(params.reason);
  const targetLabel = TARGET_LABELS[params.targetType] ?? "Video";
  const attachment = parseScreenshotDataUrl(params.screenshotDataUrl);
  const safeThumb = cleanHttpUrl(params.thumbnailUrl);
  const safeLink = cleanHttpUrl(params.targetUrl);
  const cleanText = params.targetText?.trim() || null;
  const cleanDetails = params.details?.trim() || null;
  const parsedTime = new Date(params.timestampIso);
  const formattedTime = Number.isNaN(parsedTime.getTime())
    ? params.timestampIso
    : `${parsedTime.toUTCString()} (${parsedTime.toISOString()})`;

  const subject = `[Coolerup Report] ${reasonText}: @${reported} (${targetLabel}) reported by @${reporter}`;

  const textLines = [
    "NEW COOLERUP REPORT",
    "===================",
    `Who reported: @${reporter}`,
    `Who was reported: @${reported}`,
    `What was reported: ${targetLabel}${safeLink ? ` — ${safeLink}` : ""}`,
    ...(cleanText ? [`Reported content: ${cleanText}`] : []),
    `Reason: ${reasonText}`,
    ...(cleanDetails ? [`Details: ${cleanDetails}`] : []),
    `Time: ${formattedTime}`,
    ...(safeThumb ? [`Thumbnail / Screenshot URL: ${safeThumb}`] : []),
    ...(attachment ? [`Screenshot attached: ${attachment.filename}`] : []),
  ];

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#000000;color:#ffffff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <div style="max-width:600px;margin:0 auto;border:1px solid #27272a;border-radius:16px;padding:24px;background:#09090b;">
      <p style="margin:0 0 6px;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#fe2c55;font-weight:700;">
        Coolerup Moderation Alert
      </p>
      <h1 style="margin:0 0 20px;font-size:20px;line-height:1.3;color:#ffffff;">
        New ${escapeHtml(targetLabel)} Report — ${escapeHtml(reasonText)}
      </h1>

      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#a1a1aa;width:155px;vertical-align:top;">Who reported</td>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#ffffff;font-weight:600;">@${escapeHtml(reporter)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#a1a1aa;vertical-align:top;">Who was reported</td>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#ffffff;font-weight:600;">@${escapeHtml(reported)}</td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#a1a1aa;vertical-align:top;">What was reported</td>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#ffffff;">
            <strong>${escapeHtml(targetLabel)}</strong>
            ${
              safeLink
                ? `<div style="margin-top:4px;"><a href="${escapeHtml(safeLink)}" style="color:#38bdf8;word-break:break-all;">${escapeHtml(safeLink)}</a></div>`
                : ""
            }
            ${
              cleanText
                ? `<div style="margin-top:8px;padding:10px 12px;border-radius:8px;background:#18181b;color:#f4f4f5;white-space:pre-wrap;">${escapeHtml(cleanText)}</div>`
                : ""
            }
          </td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#a1a1aa;vertical-align:top;">Reason</td>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#ffffff;">
            <span style="display:inline-block;padding:3px 10px;border-radius:999px;background:#fe2c55;color:#ffffff;font-size:12px;font-weight:700;">${escapeHtml(reasonText)}</span>
            ${
              cleanDetails
                ? `<div style="margin-top:8px;color:#e4e4e7;white-space:pre-wrap;">${escapeHtml(cleanDetails)}</div>`
                : ""
            }
          </td>
        </tr>
        <tr>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#a1a1aa;vertical-align:top;">Time</td>
          <td style="padding:10px 12px;border-top:1px solid #27272a;color:#ffffff;">${escapeHtml(formattedTime)}</td>
        </tr>
      </table>

      ${
        attachment || safeThumb
          ? `<div style="margin-top:20px;padding-top:16px;border-top:1px solid #27272a;">
               <p style="margin:0 0 10px;font-size:13px;color:#a1a1aa;font-weight:600;">Screenshot / Video Thumbnail</p>
               ${
                 attachment
                   ? `<img src="cid:${attachment.contentId}" alt="Reported content screenshot" style="display:block;max-width:100%;max-height:360px;border-radius:10px;border:1px solid #27272a;margin-bottom:10px;" />`
                   : ""
               }
               ${
                 safeThumb
                   ? `<img src="${escapeHtml(safeThumb)}" alt="Reported content thumbnail" style="display:block;max-width:100%;max-height:360px;border-radius:10px;border:1px solid #27272a;" />`
                   : ""
               }
             </div>`
          : ""
      }
    </div>
  </body>
</html>`;

  return {
    to: OWNER_REPORT_EMAIL,
    subject,
    html,
    text: textLines.join("\n"),
    attachment,
  };
}

async function resolveTransportConfig(): Promise<ResolvedEmailTransport> {
  let dbConfig: Record<string, unknown> | null = null;
  try {
    const { data } = await dbAdmin()
      .from("report_email_config")
      .select("*")
      .eq("id", "default")
      .maybeSingle();
    if (data && typeof data === "object") {
      dbConfig = data as Record<string, unknown>;
    }
  } catch {
    // Table may not exist yet before SQL migration is run.
  }

  const pick = (envKey: string, dbKey: string): string => {
    const envVal = process.env[envKey]?.trim();
    if (envVal) return envVal;
    const dbVal = dbConfig?.[dbKey];
    return typeof dbVal === "string" ? dbVal.trim() : "";
  };

  const portRaw = process.env["SMTP_PORT"]?.trim() || String(dbConfig?.["smtp_port"] ?? "587");
  const parsedPort = Number(portRaw);

  return {
    resendApiKey: pick("RESEND_API_KEY", "resend_api_key"),
    sendgridApiKey: pick("SENDGRID_API_KEY", "sendgrid_api_key"),
    smtpHost: pick("SMTP_HOST", "smtp_host"),
    smtpPort: Number.isFinite(parsedPort) && parsedPort > 0 ? parsedPort : 587,
    smtpUser: pick("SMTP_USER", "smtp_user"),
    smtpPass: pick("SMTP_PASS", "smtp_pass"),
    fromEmail:
      pick("REPORT_FROM_EMAIL", "from_email") || "Coolerup Reports <onboarding@resend.dev>",
    webhookUrl: pick("REPORT_EMAIL_WEBHOOK_URL", "webhook_url"),
  };
}

async function sendViaEmailProviders(
  email: BuiltReportEmail,
): Promise<{ sent: boolean; provider: string | null; error: string | null }> {
  const cfg = await resolveTransportConfig();
  const errors: string[] = [];

  // 1. Resend REST API
  if (cfg.resendApiKey) {
    try {
      const attachments = email.attachment
        ? [
            {
              filename: email.attachment.filename,
              content: email.attachment.base64,
              content_id: email.attachment.contentId,
            },
          ]
        : undefined;
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.resendApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: cfg.fromEmail,
          to: [OWNER_REPORT_EMAIL],
          subject: email.subject,
          html: email.html,
          text: email.text,
          ...(attachments ? { attachments } : {}),
        }),
      });
      if (res.ok) return { sent: true, provider: "resend", error: null };
      errors.push(`Resend HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    } catch (e) {
      errors.push(`Resend: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 2. SendGrid REST API
  if (cfg.sendgridApiKey) {
    try {
      const fromAddress = cfg.fromEmail.match(/<([^>]+)>/)?.[1] ?? cfg.fromEmail;
      const attachments = email.attachment
        ? [
            {
              content: email.attachment.base64,
              filename: email.attachment.filename,
              type: email.attachment.contentType,
              disposition: "inline",
              content_id: email.attachment.contentId,
            },
          ]
        : undefined;
      const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.sendgridApiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          personalizations: [{ to: [{ email: OWNER_REPORT_EMAIL }] }],
          from: { email: fromAddress, name: "Coolerup Reports" },
          subject: email.subject,
          content: [
            { type: "text/plain", value: email.text },
            { type: "text/html", value: email.html },
          ],
          ...(attachments ? { attachments } : {}),
        }),
      });
      if (res.ok) return { sent: true, provider: "sendgrid", error: null };
      errors.push(`SendGrid HTTP ${res.status}: ${await res.text().catch(() => "")}`);
    } catch (e) {
      errors.push(`SendGrid: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 3. Nodemailer SMTP (works with Gmail App Password or any SMTP relay)
  if (cfg.smtpHost && cfg.smtpUser && cfg.smtpPass) {
    try {
      const nodemailer = await import("nodemailer");
      const transporter = nodemailer.createTransport({
        host: cfg.smtpHost,
        port: cfg.smtpPort,
        secure: cfg.smtpPort === 465,
        auth: { user: cfg.smtpUser, pass: cfg.smtpPass },
      });
      const smtpFrom = cfg.fromEmail.includes("onboarding@resend.dev")
        ? `Coolerup Reports <${cfg.smtpUser}>`
        : cfg.fromEmail;
      await transporter.sendMail({
        from: smtpFrom,
        to: OWNER_REPORT_EMAIL,
        subject: email.subject,
        text: email.text,
        html: email.html,
        ...(email.attachment
          ? {
              attachments: [
                {
                  filename: email.attachment.filename,
                  content: Buffer.from(email.attachment.base64, "base64"),
                  contentType: email.attachment.contentType,
                  cid: email.attachment.contentId,
                },
              ],
            }
          : {}),
      });
      return { sent: true, provider: "smtp", error: null };
    } catch (e) {
      errors.push(`SMTP: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 4. Supabase Edge Function (if deployed in Supabase project)
  const serviceKey = process.env["SUPABASE_SERVICE_ROLE_KEY"]?.trim();
  const supabaseUrl = resolveSupabaseUrl(process.env["SUPABASE_URL"]);
  if (serviceKey && supabaseUrl) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-report-email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          subject: email.subject,
          html: email.html,
          text: email.text,
          attachmentBase64: email.attachment?.base64 ?? null,
          attachmentFilename: email.attachment?.filename ?? null,
          attachmentContentType: email.attachment?.contentType ?? null,
        }),
      });
      if (res.ok) return { sent: true, provider: "supabase-edge-function", error: null };
      errors.push(`Edge Function HTTP ${res.status}`);
    } catch (e) {
      errors.push(`Edge Function: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // 5. Webhook (e.g. Firebase Cloud Function / Relay webhook)
  if (cfg.webhookUrl) {
    try {
      const res = await fetch(cfg.webhookUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          to: OWNER_REPORT_EMAIL,
          subject: email.subject,
          html: email.html,
          text: email.text,
          attachment: email.attachment,
        }),
      });
      if (res.ok) return { sent: true, provider: "webhook", error: null };
      errors.push(`Webhook HTTP ${res.status}`);
    } catch (e) {
      errors.push(`Webhook: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return {
    sent: false,
    provider: null,
    error:
      errors.length > 0
        ? errors.join(" | ").slice(0, 500)
        : "No email provider configured (set RESEND_API_KEY, SENDGRID_API_KEY, SMTP_HOST, or Supabase Edge Function)",
  };
}

async function resolveContextMetadata(input: ProcessReportEmailInput) {
  const admin = dbAdmin();
  const reported = cleanHandle(input.reportedUsername);

  // Resolve reporter handle
  let reporterHandle = cleanHandle(input.reporterHandle);
  if (!reporterHandle && input.reporterUserId) {
    try {
      const { data } = await admin
        .from("profiles")
        .select("handle")
        .eq("id", input.reporterUserId)
        .maybeSingle();
      reporterHandle = cleanHandle((data as { handle?: string } | null)?.handle);
    } catch {
      // ignore
    }
  }
  if (!reporterHandle) reporterHandle = "user";

  // Resolve reported user id & avatar
  let reportedUserId: string | null = null;
  let reportedAvatar: string | null = null;
  if (reported) {
    try {
      const { data } = await admin
        .from("profiles")
        .select("id, avatar_url")
        .ilike("handle", reported)
        .maybeSingle();
      if (data) {
        const row = data as { id?: string; avatar_url?: string | null };
        reportedUserId = row.id ?? null;
        reportedAvatar = cleanHttpUrl(row.avatar_url);
      }
    } catch {
      // ignore
    }
  }

  let targetType: ReportTargetKind =
    input.targetType ?? (input.commentId ? "comment" : input.videoId ? "video" : "profile");

  let targetText = input.targetText?.trim() || null;
  let thumbnailUrl = cleanHttpUrl(input.thumbnailUrl);
  let targetUrl = cleanHttpUrl(input.targetUrl);
  const origin = cleanHttpUrl(input.origin)?.replace(/\/+$/, "") || "";

  // Enrich video / full_video metadata
  if (input.videoId) {
    try {
      const { data: shortRow } = await admin
        .from("videos")
        .select("id, caption, video_url, media_type")
        .eq("id", input.videoId)
        .maybeSingle();
      if (shortRow) {
        const v = shortRow as {
          id: string;
          caption?: string | null;
          video_url?: string | null;
          media_type?: string | null;
        };
        if (!targetText && v.caption) targetText = v.caption;
        if (!thumbnailUrl && v.media_type === "image") {
          thumbnailUrl = cleanHttpUrl(v.video_url);
        }
        if (!targetUrl && origin && targetType === "video") {
          targetUrl = `${origin}/v/${v.id}`;
        }
      } else {
        const { data: fullRow } = await admin
          .from("full_videos")
          .select("id, title, thumbnail_url, youtube_id, is_youtube")
          .eq("id", input.videoId)
          .maybeSingle();
        if (fullRow) {
          const fv = fullRow as {
            id: string;
            title?: string | null;
            thumbnail_url?: string | null;
            youtube_id?: string | null;
            is_youtube?: boolean | null;
          };
          if (targetType === "video") targetType = "full_video";
          if (!targetText && fv.title) targetText = fv.title;
          if (!thumbnailUrl) {
            thumbnailUrl =
              cleanHttpUrl(fv.thumbnail_url) ||
              (fv.is_youtube && fv.youtube_id
                ? `https://i.ytimg.com/vi/${encodeURIComponent(fv.youtube_id)}/hqdefault.jpg`
                : null);
          }
          if (!targetUrl && origin) {
            targetUrl = `${origin}/watch/${fv.id}`;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // Enrich comment text if omitted
  if (input.commentId && !targetText) {
    try {
      const { data: commentRow } = await admin
        .from("comments")
        .select("body, gif_url")
        .eq("id", input.commentId)
        .maybeSingle();
      if (commentRow) {
        const c = commentRow as { body?: string | null; gif_url?: string | null };
        targetText = c.body?.trim() || (c.gif_url ? "[GIF comment]" : null);
        if (!thumbnailUrl) thumbnailUrl = cleanHttpUrl(c.gif_url);
      } else {
        const { data: fvComment } = await admin
          .from("full_video_comments")
          .select("body, gif_url")
          .eq("id", input.commentId)
          .maybeSingle();
        if (fvComment) {
          const fc = fvComment as { body?: string | null; gif_url?: string | null };
          targetText = fc.body?.trim() || (fc.gif_url ? "[GIF comment]" : null);
          if (!thumbnailUrl) thumbnailUrl = cleanHttpUrl(fc.gif_url);
        }
      }
    } catch {
      // ignore
    }
  }

  if (targetType === "profile") {
    if (!targetUrl && origin && reported) {
      targetUrl = `${origin}/u/${encodeURIComponent(reported)}`;
    }
    if (!thumbnailUrl) thumbnailUrl = reportedAvatar;
  }

  return {
    reporterHandle,
    reported,
    reportedUserId,
    targetType,
    targetText,
    thumbnailUrl,
    targetUrl,
  };
}

export async function processAndEmailReport(input: ProcessReportEmailInput): Promise<{
  ok: boolean;
  reportId: string | null;
  emailSent: boolean;
  provider: string | null;
  emailError: string | null;
}> {
  const admin = dbAdmin();
  const meta = await resolveContextMetadata(input);
  const createdAt = input.createdAt || new Date().toISOString();
  const cleanDetails = input.details?.trim().slice(0, 1000) || null;
  const dbReason =
    input.reason.trim().toLowerCase() === "bullying"
      ? "harassment"
      : input.reason.trim().toLowerCase();

  let reportId: string | null = null;
  try {
    // Locate the freshly created row from report_content() RPC so we enrich it rather than duplicating.
    let findQuery = admin
      .from("reports")
      .select("id")
      .eq("reporter_id", input.reporterUserId)
      .ilike("reported_username", meta.reported)
      .eq("reason", dbReason)
      .gte("created_at", new Date(Date.now() - 120_000).toISOString())
      .order("created_at", { ascending: false })
      .limit(1);

    if (input.videoId) {
      findQuery = findQuery.eq("video_id", input.videoId);
    }

    const { data: existingRows } = await findQuery;
    const foundId = (existingRows?.[0] as { id?: string } | undefined)?.id ?? null;

    if (foundId) {
      reportId = foundId;
      await admin
        .from("reports")
        .update({
          target_type: meta.targetType,
          comment_id: input.commentId ?? null,
          target_url: meta.targetUrl,
          target_text: meta.targetText,
          thumbnail_url: meta.thumbnailUrl,
        })
        .eq("id", foundId)
        .then(undefined, () => {});
    } else if (!input.skipInsertIfMissing) {
      const insertPayload: Record<string, unknown> = {
        video_id: input.videoId ?? null,
        reported_video_id: input.videoId ?? null,
        reporter_id: input.reporterUserId,
        reporter_username: meta.reporterHandle,
        reported_user_id: meta.reportedUserId,
        reported_username: meta.reported || "unknown",
        reason: dbReason,
        details: cleanDetails,
        status: "pending",
        target_type: meta.targetType,
        comment_id: input.commentId ?? null,
        target_url: meta.targetUrl,
        target_text: meta.targetText,
        thumbnail_url: meta.thumbnailUrl,
      };
      const { data: inserted, error: insErr } = await admin
        .from("reports")
        .insert(insertPayload)
        .select("id")
        .maybeSingle();
      if (insErr) {
        // Fallback if migration 20261224000000 columns haven't been added yet
        const { data: legacyInserted } = await admin
          .from("reports")
          .insert({
            video_id: input.videoId ?? null,
            reported_video_id: input.videoId ?? null,
            reporter_id: input.reporterUserId,
            reporter_username: meta.reporterHandle,
            reported_user_id: meta.reportedUserId,
            reported_username: meta.reported || "unknown",
            reason: dbReason,
            details: cleanDetails,
            status: "pending",
          })
          .select("id")
          .maybeSingle();
        reportId = (legacyInserted as { id?: string } | null)?.id ?? null;
      } else {
        reportId = (inserted as { id?: string } | null)?.id ?? null;
      }
    }
  } catch (e) {
    console.warn("[reportEmail] Could not persist/enrich report row:", e);
  }

  const email = buildReportEmailContent({
    reporterUsername: meta.reporterHandle,
    reportedUsername: meta.reported,
    targetType: meta.targetType,
    targetUrl: meta.targetUrl,
    targetText: meta.targetText,
    reason: input.reason,
    details: cleanDetails,
    timestampIso: createdAt,
    thumbnailUrl: meta.thumbnailUrl,
    screenshotDataUrl: input.screenshotDataUrl,
  });

  const delivery = await sendViaEmailProviders(email);

  if (reportId) {
    try {
      await admin
        .from("reports")
        .update({
          email_sent: delivery.sent,
          email_error: delivery.error,
          emailed_at: delivery.sent ? new Date().toISOString() : null,
        })
        .eq("id", reportId);
    } catch {
      // Ignore if schema migration hasn't added these columns yet.
    }
  }

  return {
    ok: true,
    reportId,
    emailSent: delivery.sent,
    provider: delivery.provider,
    emailError: delivery.error,
  };
}

/* -------------------------------------------------------------------------- */
/*  Authenticated Admin Server Fallbacks (for pre-migration DBs & rich lists) */
/* -------------------------------------------------------------------------- */

export async function verifyAdminUser(userId: string): Promise<{ ok: boolean; handle: string }> {
  const admin = dbAdmin();
  try {
    const { data: profile } = await admin
      .from("profiles")
      .select("is_admin, handle")
      .eq("id", userId)
      .maybeSingle();
    const p = profile as { is_admin?: boolean | null; handle?: string | null } | null;
    if (p?.is_admin) {
      return { ok: true, handle: cleanHandle(p.handle) || "admin" };
    }
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleRow) {
      return { ok: true, handle: cleanHandle(p?.handle) || "admin" };
    }
  } catch {
    // ignore
  }
  return { ok: false, handle: "" };
}

export type SerializedReportRow = {
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
  target_type: string | null;
  comment_id: string | null;
  target_url: string | null;
  target_text: string | null;
  thumbnail_url: string | null;
  email_sent: boolean;
  email_error: string | null;
  emailed_at: string | null;
  created_at: string;
};

export async function adminListReportsServer(limit = 150): Promise<SerializedReportRow[]> {
  const { data, error } = await dbAdmin()
    .from("reports")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r["id"] ?? ""),
    video_id: typeof r["video_id"] === "string" ? r["video_id"] : null,
    reported_video_id: typeof r["reported_video_id"] === "string" ? r["reported_video_id"] : null,
    reporter_username: String(r["reporter_username"] ?? ""),
    reported_username: String(r["reported_username"] ?? ""),
    reported_user_id: typeof r["reported_user_id"] === "string" ? r["reported_user_id"] : null,
    reason: String(r["reason"] ?? "other"),
    details: typeof r["details"] === "string" ? r["details"] : null,
    status: String(r["status"] ?? "pending"),
    action_taken: typeof r["action_taken"] === "string" ? r["action_taken"] : null,
    target_type: typeof r["target_type"] === "string" ? r["target_type"] : null,
    comment_id: typeof r["comment_id"] === "string" ? r["comment_id"] : null,
    target_url: typeof r["target_url"] === "string" ? r["target_url"] : null,
    target_text: typeof r["target_text"] === "string" ? r["target_text"] : null,
    thumbnail_url: typeof r["thumbnail_url"] === "string" ? r["thumbnail_url"] : null,
    email_sent: Boolean(r["email_sent"]),
    email_error: typeof r["email_error"] === "string" ? r["email_error"] : null,
    emailed_at: typeof r["emailed_at"] === "string" ? r["emailed_at"] : null,
    created_at: String(r["created_at"] ?? ""),
  }));
}

/**
 * Keep a copy of the row in `deleted_content` before removing it, so a manual
 * delete from Admin > Reports can be undone by the restore that runs on app
 * load. Best effort: if the archive table isn't there yet we still delete.
 */
async function archiveThenDelete(
  admin: ReturnType<typeof dbAdmin>,
  table: string,
  id: string,
  actor: string,
  reason: string,
): Promise<void> {
  try {
    const { data } = await admin.from(table).select("*").eq("id", id).maybeSingle();
    if (data) {
      await admin.from("deleted_content").insert({
        table_name: table,
        row_id: id,
        row_data: data as never,
        deleted_by: actor,
        reason,
      });
    }
  } catch {
    // Archive is optional; never block the delete on it.
  }
  await admin.from(table).delete().eq("id", id);
}

export async function adminDeletePostServer(adminUserId: string, reportId: string) {
  const check = await verifyAdminUser(adminUserId);
  if (!check.ok) return { ok: false, error: "Admins only" };

  const admin = dbAdmin();
  const { data: report, error: fetchErr } = await admin
    .from("reports")
    .select("*")
    .eq("id", reportId)
    .maybeSingle();
  if (fetchErr || !report) return { ok: false, error: "Report not found" };

  const row = report as Record<string, unknown>;
  const targetType = String(row["target_type"] ?? (row["comment_id"] ? "comment" : "video"));
  const commentId = (row["comment_id"] as string | null) ?? null;
  const videoId = (row["video_id"] as string | null) ?? null;

  // Also check legacy `[comment:<uuid>]` marker inside `details` if `comment_id` column wasn't set.
  const detailsText = typeof row["details"] === "string" ? row["details"] : "";
  const markerCommentId =
    commentId ?? detailsText.match(/\[comment:([0-9a-f-]{36})\]/i)?.[1] ?? null;

  const deleteReason = String(row["reason"] ?? "Reported post removed by admin");

  if (markerCommentId) {
    await archiveThenDelete(admin, "comments", markerCommentId, check.handle, deleteReason);
    await archiveThenDelete(admin, "full_video_comments", markerCommentId, check.handle, deleteReason);
  } else if (videoId) {
    await archiveThenDelete(admin, "videos", videoId, check.handle, deleteReason);
    await archiveThenDelete(admin, "full_videos", videoId, check.handle, deleteReason);
  } else {
    return { ok: false, error: "No post or comment attached to this report" };
  }

  await admin
    .from("reports")
    .update({ status: "actioned", action_taken: "post_deleted" })
    .eq("id", reportId);

  try {
    await admin.from("moderation_log").insert({
      user_id: (row["reported_user_id"] as string | null) ?? null,
      username: (row["reported_username"] as string | null) ?? null,
      action: "admin_delete_post",
      reason: String(row["reason"] ?? "Reported post removed by admin"),
      auto: false,
      actor: check.handle,
      actor_id: adminUserId,
      content_type: targetType,
      content_id: markerCommentId ?? videoId,
    });
  } catch {
    // ignore optional log columns
  }

  return { ok: true };
}

export async function adminBanForReportServer(
  adminUserId: string,
  reportId: string,
  hours: number | null,
  permanent: boolean,
  customReason?: string | null,
) {
  const check = await verifyAdminUser(adminUserId);
  if (!check.ok) return { ok: false, error: "Admins only" };

  const admin = dbAdmin();
  const { data: report } = await admin.from("reports").select("*").eq("id", reportId).maybeSingle();
  if (!report) return { ok: false, error: "Report not found" };

  const row = report as Record<string, unknown>;
  const reportedHandle = cleanHandle(String(row["reported_username"] ?? ""));
  if (!reportedHandle) return { ok: false, error: "Missing username on report" };

  let targetUserId = (row["reported_user_id"] as string | null) ?? null;
  if (!targetUserId) {
    const { data: p } = await admin
      .from("profiles")
      .select("id")
      .ilike("handle", reportedHandle)
      .maybeSingle();
    targetUserId = (p as { id?: string } | null)?.id ?? null;
  }

  const reason =
    customReason?.trim() ||
    `Report: ${formatReportReasonLabel(String(row["reason"] ?? "rule violation"))}`;
  const expiresAt =
    !permanent && hours && hours > 0
      ? new Date(Date.now() + hours * 3_600_000).toISOString()
      : null;

  await admin.from("bans").insert({
    user_id: targetUserId,
    username: reportedHandle,
    reason,
    banned_by: check.handle,
    kind: "ban",
    is_permanent: permanent,
    expires_at: expiresAt,
    auto: false,
  });

  await admin
    .from("reports")
    .update({ status: "actioned", action_taken: "banned" })
    .eq("id", reportId);

  return { ok: true };
}
