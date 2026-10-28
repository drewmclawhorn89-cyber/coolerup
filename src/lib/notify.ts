/**
 * One call to create an in-app notification *and* deliver the same event as an
 * out-of-app Web Push. Keeping both in one helper means the bell and the phone's
 * notification tray never drift apart.
 */
import { supabase } from "@/integrations/supabase/client";
import { sendNotificationPush } from "@/lib/push.functions";

export type NotifyKind =
  | "like"
  | "comment"
  | "follow"
  | "repost"
  | "story_like"
  | "message"
  | "mention"
  | "live";

const TITLES: Record<string, string> = {
  like: "New like",
  comment: "New comment",
  follow: "New follower",
  repost: "New repost",
  story_like: "New story like",
  message: "New message",
  mention: "You were mentioned",
  live: "LIVE now",
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
 * Best-effort: a failed push must never break the action that caused it (a
 * like should still save even if the recipient's device is unreachable).
 */
export async function notifyUser(input: NotifyInput): Promise<void> {
  const { targetUserId, actorUserId, type, text, videoId, url, title } = input;
  if (!targetUserId || !actorUserId || targetUserId === actorUserId) return;

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
