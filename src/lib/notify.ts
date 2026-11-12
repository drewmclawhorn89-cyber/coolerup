/**
 * One call to create an in-app notification *and* deliver the same event as an
 * out-of-app Web Push. Keeping both in one helper means the bell and the phone's
 * notification tray never drift apart.
 */
import { supabase } from "@/integrations/supabase/client";
import { sendNotificationPush } from "@/lib/push.functions";

export type NotifyKind =
  "like" | "comment" | "follow" | "repost" | "story_like" | "message" | "mention" | "live" | "gift";

const TITLES: Record<string, string> = {
  like: "New like",
  comment: "New comment",
  follow: "New follower",
  repost: "New repost",
  story_like: "New story like",
  message: "New message",
  mention: "You were mentioned",
  live: "LIVE now",
  gift: "Christmas gift 🎁",
};

export type NotifyInput = {
  /** The user who should receive the notification. */
  targetUserId: string;
  /** The user who triggered it (the signed-in actor). */
  actorUserId: string;
  type: NotifyKind | string;
  /** Human-readable line, also used as the push body. */
  text: string;
  videoId?: string | null;
  /** Where tapping the notification should land. Defaults to the feed. */
  url?: string;
  /** Overrides the default title for the event type. */
  title?: string;
};

/**
 * Client-side mirror of the server rule: you may only notify yourself, someone
 * you follow (or who follows you), or — if you're an admin — anyone. The
 * database enforces this with `public.can_notify()`; checking here keeps the
 * UI from attempting a write that will be rejected.
 */
async function canNotify(targetUserId: string, actorUserId: string): Promise<boolean> {
  if (!targetUserId || targetUserId === actorUserId) return true;

  try {
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: unknown; error: unknown }>;
    const { data, error } = await rpc("can_notify", { _target: targetUserId });
    if (!error && typeof data === "boolean") return data;
  } catch {
    // RPC not deployed yet — fall back to a direct follow lookup.
  }

  const [{ data: me }, { data: them }] = await Promise.all([
    supabase.from("profiles").select("handle, is_admin").eq("id", actorUserId).maybeSingle(),
    supabase.from("profiles").select("handle").eq("id", targetUserId).maybeSingle(),
  ]);
  if (!me) return false;
  if ((me as { is_admin?: boolean | null }).is_admin === true) return true;
  if (!me.handle || !them?.handle) return false;

  const mine = me.handle.toLowerCase();
  const theirs = them.handle.toLowerCase();
  const { data: follow } = await supabase
    .from("follows")
    .select("id")
    .or(
      `and(follower_username.eq.${mine},following_username.eq.${theirs}),and(follower_username.eq.${theirs},following_username.eq.${mine})`,
    )
    .limit(1)
    .maybeSingle();
  return Boolean(follow);
}

/**
 * Best-effort: a failed push must never break the action that caused it (a
 * like should still save even if the recipient's device is unreachable).
 */
export async function notifyUser(input: NotifyInput): Promise<void> {
  const { targetUserId, actorUserId, type, text, videoId, url, title } = input;
  if (!targetUserId || !actorUserId || targetUserId === actorUserId) return;

  if (!(await canNotify(targetUserId, actorUserId))) {
    console.warn("[notify] blocked: no follow relationship with the recipient");
    return;
  }

  const { error } = await supabase.from("notifications").insert({
    target_user_id: targetUserId,
    actor_user_id: actorUserId,
    type,
    text,
    video_id: videoId ?? null,
  });
  if (error) {
    console.warn("[notify] couldn't save notification", error.message);
    return;
  }

  try {
    await sendNotificationPush({
      data: {
        targetUserId,
        kind: type,
        title: title ?? TITLES[type] ?? "Coolerup",
        body: text,
        url: url ?? "/",
        tag: `${type}:${videoId ?? actorUserId}`,
      },
    });
  } catch (e) {
    console.warn("[notify] push failed", e);
  }
}

/** Look up a profile id from a handle (without the leading @). */
export async function profileIdForHandle(handle: string): Promise<string | null> {
  const clean = handle.trim().replace(/^@/, "").toLowerCase();
  if (!clean) return null;
  const { data } = await supabase.from("profiles").select("id").eq("handle", clean).maybeSingle();
  return data?.id ?? null;
}
