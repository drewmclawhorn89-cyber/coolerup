import { resolveAvatarUrl } from "@/components/EditProfileDialog";
import { supabase } from "@/integrations/supabase/client";
import type { SoundSummary, Video } from "@/lib/loop";

export type NotificationRow = {
  id: string;
  text: string | null;
  type: string | null;
  read: boolean | null;
  created_at: string | null;
  actor_user_id: string | null;
  target_user_id: string | null;
  video_id: string | null;
};

export type InboxActor = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type HighlightCommentTarget = {
  id?: string | null;
  username?: string | null;
  bodyPrefix?: string | null;
  createdAt?: string | null;
};

export type CommentMatchCandidate = {
  id: string;
  username: string;
  body: string;
  created_at: string;
};

const VIDEO_WITH_SOUND =
  "id, username, caption, video_url, likes_count, comments_count, shares_count, reposts_count, created_at, sound_id, is_tiktok, tiktok_id, tiktok_author, is_paid, price_cents, is_mature, sounds!videos_sound_id_fkey(id, original_video_id, audio_url, title, creator_username, uses_count)";
const VIDEO_WITHOUT_SOUND =
  "id, username, caption, video_url, likes_count, comments_count, shares_count, reposts_count, created_at, sound_id, is_tiktok, tiktok_id, tiktok_author, is_paid, price_cents, is_mature";
const VIDEO_LEGACY =
  "id, username, caption, video_url, likes_count, comments_count, shares_count, reposts_count, created_at, sound_id, is_mature";
const VIDEO_ANCIENT =
  "id, username, caption, video_url, likes_count, comments_count, shares_count, reposts_count, created_at, sound_id";

/**
 * Parse `"alice commented: Love this!"` back into `{ username, bodyPrefix }`.
 * Falls back to `actorHandle` when the text omits or alters the handle.
 */
export function parseCommentNotification(
  text: string | null | undefined,
  actorHandle?: string | null,
): { username: string | null; bodyPrefix: string | null } {
  const raw = (text ?? "").trim();
  const idx = raw.indexOf(" commented:");
  if (idx > 0) {
    const parsedUser = raw.slice(0, idx).replace(/^@/, "").trim();
    const after = raw.slice(idx + " commented:".length).trim();
    return {
      username: actorHandle?.replace(/^@/, "").trim() || parsedUser || null,
      bodyPrefix: after || null,
    };
  }
  return {
    username: actorHandle?.replace(/^@/, "").trim() || null,
    bodyPrefix: null,
  };
}

/**
 * Extract the follower's handle for Follow notifications. Prefers the live
 * `profiles.handle` resolved from `actor_user_id`, falling back to the text.
 */
export function parseFollowHandle(
  text: string | null | undefined,
  actorHandle?: string | null,
): string | null {
  const cleanActor = actorHandle?.replace(/^@/, "").trim();
  if (cleanActor) return cleanActor;
  const m = (text ?? "").trim().match(/^@?([^\s]+)\s+started following you/i);
  const parsed = m?.[1]?.trim();
  if (!parsed || parsed.toLowerCase() === "someone") return null;
  return parsed;
}

/**
 * Pick the exact comment inside a thread that matches a comment notification.
 * Prefers matching username + body prefix, breaking ties by closest timestamp.
 */
export function findHighlightedCommentId(
  comments: CommentMatchCandidate[],
  target: HighlightCommentTarget | null | undefined,
): string | null {
  if (!target || comments.length === 0) return null;

  if (target.id && comments.some((c) => c.id === target.id)) {
    return target.id;
  }

  const targetUser = (target.username ?? "").replace(/^@/, "").trim().toLowerCase();
  const targetBody = (target.bodyPrefix ?? "").trim();
  const targetTime = target.createdAt ? Date.parse(target.createdAt) : Number.NaN;

  const hasKnownUser = Boolean(targetUser && targetUser !== "someone");
  const userMatches = hasKnownUser
    ? comments.filter((c) => c.username.trim().toLowerCase() === targetUser)
    : [];

  const timeDistance = (c: CommentMatchCandidate) => {
    const t = Date.parse(c.created_at);
    if (!Number.isFinite(targetTime) || !Number.isFinite(t)) return Number.MAX_SAFE_INTEGER;
    return Math.abs(targetTime - t);
  };

  const pickClosest = (list: CommentMatchCandidate[]) => {
    if (list.length === 0) return null;
    return [...list].sort((a, b) => timeDistance(a) - timeDistance(b))[0]?.id ?? null;
  };

  if (targetBody) {
    const needle = targetBody.toLowerCase();
    const userAndPrefix = userMatches.filter((c) =>
      (c.body ?? "").trim().toLowerCase().startsWith(needle),
    );
    if (userAndPrefix.length > 0) return pickClosest(userAndPrefix);

    const userAndIncludes = userMatches.filter((c) =>
      (c.body ?? "").trim().toLowerCase().includes(needle),
    );
    if (userAndIncludes.length > 0) return pickClosest(userAndIncludes);

    const anyPrefix = comments.filter((c) =>
      (c.body ?? "").trim().toLowerCase().startsWith(needle),
    );
    if (anyPrefix.length > 0) return pickClosest(anyPrefix);
  }

  if (userMatches.length > 0) {
    return pickClosest(userMatches);
  }

  return null;
}

/** Batch-fetch videos referenced by Inbox notifications. */
export async function hydrateNotificationVideos(videoIds: string[]): Promise<Map<string, Video>> {
  const unique = [...new Set(videoIds.filter(Boolean))];
  const out = new Map<string, Video>();
  if (unique.length === 0) return out;

  let { data, error } = await supabase.from("videos").select(VIDEO_WITH_SOUND).in("id", unique);

  if (error) {
    const retry = await supabase.from("videos").select(VIDEO_WITHOUT_SOUND).in("id", unique);
    data = retry.data as typeof data;
    error = retry.error;
  }

  if (
    error &&
    /is_tiktok|tiktok_id|tiktok_author|is_paid|price_cents|is_mature/i.test(error.message ?? "")
  ) {
    const legacy = await supabase.from("videos").select(VIDEO_LEGACY).in("id", unique);
    data = legacy.data as typeof data;
    error = legacy.error;
  }

  if (error && /is_mature/i.test(error.message ?? "")) {
    const ancient = await supabase.from("videos").select(VIDEO_ANCIENT).in("id", unique);
    data = ancient.data as typeof data;
    error = ancient.error;
  }

  if (error || !data) return out;

  for (const row of data) {
    const v = row as Video & { sounds?: SoundSummary | null; reposts_count?: number };
    out.set(v.id, {
      ...v,
      reposts: v.reposts_count ?? 0,
      sound: v.sounds ?? null,
    });
  }
  return out;
}

/** Batch-fetch actor profiles (handle + resolved avatar URL) for Inbox notifications. */
export async function hydrateNotificationActors(
  actorIds: string[],
): Promise<Map<string, InboxActor>> {
  const unique = [...new Set(actorIds.filter(Boolean))];
  const out = new Map<string, InboxActor>();
  if (unique.length === 0) return out;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, display_name, avatar_url")
    .in("id", unique);

  if (error || !data) return out;

  await Promise.all(
    data.map(async (p) => {
      const avatar = await resolveAvatarUrl(p.avatar_url).catch(() => null);
      out.set(p.id, {
        id: p.id,
        handle: p.handle,
        display_name: p.display_name,
        avatar_url: avatar,
      });
    }),
  );

  return out;
}
