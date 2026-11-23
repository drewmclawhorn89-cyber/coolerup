import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import firebaseConfig from "../../../../firebase-applet-config.json";
import { resolveSupabaseUrl } from "@/integrations/supabase/project";
import type { ReportTargetKind } from "@/lib/reportEmail.server";

type ReportNotifyBody = {
  reporterHandle?: string | null;
  reportedUsername?: string;
  targetType?: ReportTargetKind;
  videoId?: string | null;
  commentId?: string | null;
  targetUrl?: string | null;
  targetText?: string | null;
  thumbnailUrl?: string | null;
  screenshotDataUrl?: string | null;
  reason?: string;
  details?: string | null;
  origin?: string | null;
  skipInsertIfMissing?: boolean;
};

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function verifyCaller(authHeader: string | null): Promise<{ userId: string } | null> {
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.split(".").length !== 3) return null;

  const supabaseUrl = resolveSupabaseUrl(process.env["SUPABASE_URL"]);
  const publishableKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
  if (supabaseUrl && publishableKey) {
    try {
      const client = createClient(supabaseUrl, publishableKey, {
        auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await client.auth.getUser(token);
      if (!error && data?.user?.id) {
        return { userId: data.user.id };
      }
    } catch {
      // Fall through to Firebase ID token verification (for Firebase Phone Auth sessions).
    }
  }

  const firebaseApiKey = process.env["VITE_FIREBASE_API_KEY"]?.trim() || firebaseConfig.apiKey;
  if (firebaseApiKey) {
    try {
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(firebaseApiKey)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ idToken: token }),
        },
      );
      if (res.ok) {
        const data = (await res.json()) as { users?: Array<{ localId?: string }> };
        const uid = data.users?.[0]?.localId;
        if (uid) return { userId: uid };
      }
    } catch {
      // invalid Firebase token
    }
  }

  return null;
}

export const Route = createFileRoute("/api/reports/notify")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await verifyCaller(request.headers.get("authorization"));
        if (!caller) {
          return json(401, { ok: false, error: "Sign in to submit a report." });
        }

        let body: ReportNotifyBody;
        try {
          body = (await request.json()) as ReportNotifyBody;
        } catch {
          return json(400, { ok: false, error: "Invalid JSON payload." });
        }

        const reportedUsername = (body.reportedUsername ?? "").replace(/^@+/, "").trim();
        const reason = (body.reason ?? "").trim();
        if (!reportedUsername || !reason) {
          return json(400, { ok: false, error: "Missing reportedUsername or reason." });
        }

        const { processAndEmailReport } = await import("@/lib/reportEmail.server");
        const result = await processAndEmailReport({
          reporterUserId: caller.userId,
          reporterHandle: body.reporterHandle ?? null,
          reportedUsername,
          targetType: body.targetType,
          videoId: body.videoId ?? null,
          commentId: body.commentId ?? null,
          targetUrl: body.targetUrl ?? null,
          targetText: body.targetText ?? null,
          thumbnailUrl: body.thumbnailUrl ?? null,
          screenshotDataUrl: body.screenshotDataUrl ?? null,
          reason,
          details: body.details ?? null,
          origin: body.origin ?? null,
          skipInsertIfMissing: body.skipInsertIfMissing ?? false,
        });

        return json(200, result);
      },
    },
  },
});
