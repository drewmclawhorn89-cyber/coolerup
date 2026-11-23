/**
 * Supabase Edge Function: send-report-email
 *
 * Always delivers report notifications ONLY to coolerup47@gmail.com.
 * Any recipient field in the request body is intentionally ignored so callers
 * can never redirect or discover the owner's email address.
 *
 * Deploy with:
 *   supabase functions deploy send-report-email
 *   supabase secrets set RESEND_API_KEY=... REPORT_FROM_EMAIL="Coolerup Reports <onboarding@resend.dev>"
 */

const OWNER_REPORT_EMAIL = "coolerup47@gmail.com";

type ReportEmailPayload = {
  subject?: string;
  html?: string;
  text?: string;
  attachmentBase64?: string | null;
  attachmentFilename?: string | null;
  attachmentContentType?: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let body: ReportEmailPayload;
  try {
    body = (await req.json()) as ReportEmailPayload;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Invalid JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const subject = (body.subject ?? "New Coolerup Report").slice(0, 200);
  const html = body.html ?? "";
  const text = body.text ?? "";
  const from =
    Deno.env.get("REPORT_FROM_EMAIL")?.trim() || "Coolerup Reports <onboarding@resend.dev>";

  const resendKey = Deno.env.get("RESEND_API_KEY")?.trim();
  if (resendKey) {
    const attachments =
      body.attachmentBase64 && body.attachmentFilename
        ? [
            {
              filename: body.attachmentFilename,
              content: body.attachmentBase64,
              content_id: "report-screenshot",
            },
          ]
        : undefined;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [OWNER_REPORT_EMAIL],
        subject,
        html,
        text,
        ...(attachments ? { attachments } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return new Response(JSON.stringify({ ok: false, error: errText }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, provider: "resend" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  const sendgridKey = Deno.env.get("SENDGRID_API_KEY")?.trim();
  if (sendgridKey) {
    const attachments =
      body.attachmentBase64 && body.attachmentFilename
        ? [
            {
              content: body.attachmentBase64,
              filename: body.attachmentFilename,
              type: body.attachmentContentType || "image/jpeg",
              disposition: "inline",
              content_id: "report-screenshot",
            },
          ]
        : undefined;

    const fromEmail = from.match(/<([^>]+)>/)?.[1] ?? from;
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sendgridKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: OWNER_REPORT_EMAIL }] }],
        from: { email: fromEmail, name: "Coolerup Reports" },
        subject,
        content: [
          { type: "text/plain", value: text },
          { type: "text/html", value: html },
        ],
        ...(attachments ? { attachments } : {}),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`);
      return new Response(JSON.stringify({ ok: false, error: errText }), {
        status: 502,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, provider: "sendgrid" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: false,
      error: "No email provider secret configured on Edge Function",
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
});
