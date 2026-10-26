import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// push_subscriptions is newer than the generated Supabase types, so use an untyped table handle.
type Sub = { endpoint: string; p256dh: string; auth: string };
type PushTable = {
  upsert: (row: Record<string, string>) => PromiseLike<{ error: unknown }>;
  select: (cols: string) => { eq: (col: string, v: string) => PromiseLike<{ data: Sub[] | null }> };
  delete: () => { eq: (col: string, v: string) => PromiseLike<unknown> };
};
const pushTable = (client: unknown) =>
  (client as { from: (t: string) => unknown }).from("push_subscriptions") as PushTable;

type SubscriptionInput = { endpoint: string; p256dh: string; auth: string };

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

// Wakes the callee's devices. The caller's handle comes from the database, not the client.
export const sendCallPush = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { peerId: string }) => {
    if (!d?.peerId || typeof d.peerId !== "string") throw new Error("Invalid peer");
    return d;
  })
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { buildPushPayload } = await import("@block65/webcrypto-web-push");

    const subject = process.env["VAPID_SUBJECT"];
    const publicKey = process.env["VAPID_SERVER_PUBLIC_KEY"];
    const privateKey = process.env["VAPID_SERVER_PRIVATE_KEY"];
    if (!subject || !publicKey || !privateKey) return { sent: 0, configured: false };

    const { data: me } = await supabaseAdmin
      .from("profiles")
      .select("handle")
      .eq("id", context.userId)
      .maybeSingle();
    if (!me?.handle) return { sent: 0, configured: true };

    const { data: subs } = await pushTable(supabaseAdmin)
      .select("endpoint, p256dh, auth")
      .eq("user_id", data.peerId);

    let sent = 0;
    for (const s of subs ?? []) {
      try {
        const payload = await buildPushPayload(
          { data: JSON.stringify({ kind: "call", from: me.handle }), options: { ttl: 30, urgency: "high" } },
          { endpoint: s.endpoint, expirationTime: null, keys: { p256dh: s.p256dh, auth: s.auth } },
          { subject, publicKey, privateKey },
        );
        const res = await fetch(s.endpoint, payload);
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
