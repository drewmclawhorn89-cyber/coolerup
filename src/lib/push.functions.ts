import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// push_subscriptions is newer than the generated Supabase types, so use an untyped table handle.
type Sub = { endpoint: string; p256dh: string; auth: string };
type DeleteChain = {
  eq: (col: string, v: string) => DeleteChain;
} & PromiseLike<unknown>;
type PushTable = {
  upsert: (row: Record<string, string>) => PromiseLike<{ error: unknown }>;
  select: (cols: string) => { eq: (col: string, v: string) => PromiseLike<{ data: Sub[] | null }> };
  delete: () => DeleteChain;
};
const pushTable = (client: unknown) =>
  (client as { from: (t: string) => unknown }).from("push_subscriptions") as PushTable;

type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

type PushPayload = {
  kind: string;
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  from?: string;
};

type VapidConfig = { subject: string; publicKey: string; privateKey: string };

/**
 * Resolves the VAPID credentials.
 *
 * Order matters: environment variables win, because they're the normal way to
 * configure a deployment. If they're absent we fall back to a single row in
 * `push_config`, which lets a project be configured from the Supabase SQL editor
 * without touching the hosting provider's env settings.
 *
 * `push_config` has RLS enabled and *no* policies, so only the service-role
 * client used here can read it — never the browser, never anon.
 */
async function loadVapidConfig(): Promise<VapidConfig | null> {
  const subject = process.env["VAPID_SUBJECT"];
  const publicKey = process.env["VAPID_SERVER_PUBLIC_KEY"];
  const privateKey = process.env["VAPID_SERVER_PRIVATE_KEY"];
  if (subject && publicKey && privateKey) return { subject, publicKey, privateKey };

  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await (supabaseAdmin as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (col: string, v: string) => {
            maybeSingle: () => PromiseLike<{
              data: { subject?: string | null; public_key?: string | null; private_key?: string | null } | null;
            }>;
          };
        };
      };
    })
      .from("push_config")
      .select("subject, public_key, private_key")
      .eq("id", "default")
      .maybeSingle();

    if (data?.subject && data.public_key && data.private_key) {
      return {
        subject: data.subject,
        publicKey: data.public_key,
        privateKey: data.private_key,
      };
    }
  } catch {
    // Table missing or unreachable — treat as unconfigured.
  }
  return null;
}

/**
 * Low-level fan-out: encrypts and delivers one payload to every device the
 * target user has registered. Dead endpoints (404/410) are pruned. Returns
 * `configured: false` when the VAPID keys are missing so callers can degrade
 * quietly instead of throwing.
 */
async function sendPushToUser(
  userId: string,
  payload: PushPayload,
  options: { ttl: number; urgency: "high" | "normal" },
): Promise<{ sent: number; configured: boolean }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { buildPushPayload } = await import("@block65/webcrypto-web-push");

  const config = await loadVapidConfig();
  if (!config) return { sent: 0, configured: false };
  const { subject, publicKey, privateKey } = config;

  const { data: subs } = await pushTable(supabaseAdmin)
    .select("endpoint, p256dh, auth")
    .eq("user_id", userId);

  let sent = 0;
  for (const s of subs ?? []) {
    try {
      const built = await buildPushPayload(
        { data: JSON.stringify(payload), options },
        { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
        { subject, publicKey, privateKey },
      );
      const res = await fetch(s.endpoint, built);
      if (res.status === 404 || res.status === 410) {
        await pushTable(supabaseAdmin).delete().eq("endpoint", s.endpoint);
      } else if (res.ok) {
        sent++;
      }
    } catch (e) {
      console.error("[push] send failed", e);
    }
  }
  return { sent, configured: true };
}

export const savePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: SubscriptionInput) => {
    if (!d?.endpoint?.startsWith("https://") || !d.p256dh || !d.auth) {
      throw new Error("Invalid subscription");
    }
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await pushTable(supabaseAdmin).upsert({
      endpoint: data.endpoint,
      user_id: context.userId,
      p256dh: data.p256dh,
      auth: data.auth,
    });
    if (error) throw new Error("Couldn't save subscription");
    return { ok: true };
  });

/** Forget this device. Used when the user turns notifications off. */
export const removePushSubscription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { endpoint: string }) => {
    if (!d?.endpoint) throw new Error("Invalid subscription");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await pushTable(supabaseAdmin)
      .delete()
      .eq("endpoint", data.endpoint)
      .eq("user_id", context.userId);
    return { ok: true };
  });

/**
 * Delivers an out-of-app notification to a user's devices. Called right after
 * the in-app `notifications` row is written, so the bell and the OS tray stay in
 * sync. The caller must be signed in, and can't notify themselves.
 */
export const sendNotificationPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { targetUserId: string; kind: string; title?: string; body?: string; url?: string; tag?: string }) => {
    if (!d?.targetUserId || typeof d.targetUserId !== "string") throw new Error("Invalid target");
    if (!d?.kind || typeof d.kind !== "string") throw new Error("Invalid kind");
    return {
      targetUserId: d.targetUserId,
      kind: d.kind.slice(0, 40),
      title: (d.title ?? "Coolerup").slice(0, 120),
      body: (d.body ?? "").slice(0, 240),
      url: (d.url ?? "/").slice(0, 500),
      tag: d.tag ? d.tag.slice(0, 80) : undefined,
    };
  })
  .handler(async ({ data, context }) => {
    if (data.targetUserId === context.userId) return { sent: 0, configured: true };
    return sendPushToUser(
      data.targetUserId,
      {
        kind: data.kind,
        title: data.title,
        body: data.body,
        url: data.url,
        tag: data.tag ?? data.kind,
      },
      { ttl: 60 * 60 * 24, urgency: "normal" },
    );
  });

// Wakes the callee's devices. The caller's handle comes from the database, not the client.
export const sendCallPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { peerId: string }) => {
    if (!d?.peerId || typeof d.peerId !== "string") throw new Error("Invalid peer");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("handle")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me?.handle) return { sent: 0, configured: true };

    return sendPushToUser(
      data.peerId,
      { kind: "call", from: me.handle },
      { ttl: 30, urgency: "high" },
    );
  });

// Permanently deletes the signed-in user's account (auth user; owned rows cascade where configured).
export const deleteMyAccount = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.auth.admin.deleteUser(context.userId);
    if (error) throw new Error("Couldn't delete account");
    return { ok: true };
  });

/**
 * Diagnostics for Settings: is the server actually able to send push (VAPID
 * keys present) and how many devices has this user registered? Without this,
 * a missing key silently turns every notification into a no-op.
 */
export const getPushStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const config = await loadVapidConfig();
    const fromEnv = Boolean(
      process.env["VAPID_SUBJECT"] &&
        process.env["VAPID_SERVER_PUBLIC_KEY"] &&
        process.env["VAPID_SERVER_PRIVATE_KEY"],
    );
    let devices = 0;
    try {
      const { data } = await pushTable(supabaseAdmin)
        .select("endpoint")
        .eq("user_id", context.userId);
      devices = data?.length ?? 0;
    } catch {
      // Table missing or unreachable — report zero devices rather than throwing.
    }
    return {
      configured: Boolean(config),
      devices,
      // Where the credentials came from, so a misconfiguration is diagnosable.
      source: config ? (fromEnv ? "env" : "database") : "none",
    };
  });

/** Fires a test notification at the signed-in user's own devices. */
export const sendTestPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return sendPushToUser(
      context.userId,
      {
        kind: "test",
        title: "Coolerup test notification",
        body: "If you can see this, out-of-app notifications are working.",
        url: "/settings",
        tag: "test",
      },
      { ttl: 60, urgency: "normal" },
    );
  });
