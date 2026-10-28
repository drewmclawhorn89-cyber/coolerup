import { supabase } from "@/integrations/supabase/client";

/**
 * Groups (Facebook-style group pages).
 *
 * Tables: groups, group_members, group_posts (see supabase/migrations).
 * The generated Supabase types don't know about these tables yet, so every
 * query goes through a loosely typed handle instead of `supabase.from(...)`.
 */
const db = supabase as any;

export type GroupPrivacy = "public" | "private";
export type GroupRole = "admin" | "moderator" | "member" | "pending" | "banned";

export type Group = {
  id: string;
  name: string;
  description: string | null;
  cover_image: string | null;
  avatar_image: string | null;
  privacy: GroupPrivacy;
  creator_id: string;
  creator_username: string;
  created_at: string;
  members_count: number;
};

export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  username: string;
  role: GroupRole;
  joined_at: string;
};

export type GroupPost = {
  id: string;
  group_id: string;
  user_id: string;
  username: string;
  caption: string | null;
  video_url: string | null;
  image_url: string | null;
  created_at: string;
  likes: number | null;
};

export type GroupInput = {
  name: string;
  description?: string | null;
  privacy: GroupPrivacy;
  cover_image?: string | null;
  avatar_image?: string | null;
};

const GROUP_COLUMNS =
  "id, name, description, cover_image, avatar_image, privacy, creator_id, creator_username, created_at, members_count";

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function fetchGroups(): Promise<Group[]> {
  const { data, error } = await db
    .from("groups")
    .select(GROUP_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Group[];
}

export async function fetchGroup(groupId: string): Promise<Group | null> {
  const { data, error } = await db.from("groups").select(GROUP_COLUMNS).eq("id", groupId).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Group | null;
}

/** Every membership row for a user, keyed by group id (includes pending/banned). */
export async function fetchMyMemberships(userId: string): Promise<Record<string, GroupMember>> {
  const { data, error } = await db.from("group_members").select("*").eq("user_id", userId);
  if (error) throw error;
  const map: Record<string, GroupMember> = {};
  for (const row of (data ?? []) as GroupMember[]) map[row.group_id] = row;
  return map;
}

export async function fetchGroupMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await db
    .from("group_members")
    .select("*")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  const rank: Record<string, number> = { admin: 0, moderator: 1, member: 2, pending: 3, banned: 4 };
  return ((data ?? []) as GroupMember[]).sort((a, b) => (rank[a.role] ?? 9) - (rank[b.role] ?? 9));
}

export async function fetchGroupPosts(groupId: string): Promise<GroupPost[]> {
  const { data, error } = await db
    .from("group_posts")
    .select("*")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as GroupPost[];
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createGroup(
  input: GroupInput,
  creator: { id: string; username: string },
): Promise<Group> {
  const name = input.name.trim();
  if (!name) throw new Error("Give your group a name.");

  const { data, error } = await db
    .from("groups")
    .insert({
      name,
      description: input.description?.trim() || null,
      privacy: input.privacy,
      cover_image: input.cover_image || null,
      avatar_image: input.avatar_image || null,
      creator_id: creator.id,
      creator_username: creator.username,
      members_count: 1,
    })
    .select(GROUP_COLUMNS)
    .single();
  if (error) throw error;

  const group = data as Group;

  // The creator is always the first admin.
  const { error: memberError } = await db.from("group_members").insert({
    group_id: group.id,
    user_id: creator.id,
    username: creator.username,
    role: "admin",
  });
  if (memberError) throw memberError;

  return group;
}

/**
 * Public groups: instant membership.
 * Private groups: the row is stored with role "pending" until an admin approves.
 */
export async function joinGroup(group: Group, user: { id: string; username: string }): Promise<GroupRole> {
  const role: GroupRole = group.privacy === "private" ? "pending" : "member";
  const { error } = await db.from("group_members").insert({
    group_id: group.id,
    user_id: user.id,
    username: user.username,
    role,
  });
  if (error) throw error;

  if (role === "member") await bumpMembers(group.id, 1);
  return role;
}

export async function leaveGroup(groupId: string, userId: string, role?: GroupRole): Promise<void> {
  const { error } = await db.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
  if (error) throw error;
  if (role === "member" || role === "moderator" || role === "admin") await bumpMembers(groupId, -1);
}

export async function approveMember(groupId: string, userId: string): Promise<void> {
  const { error } = await db.from("group_members").update({ role: "member" }).eq("group_id", groupId).eq("user_id", userId);
  if (error) throw error;
  await bumpMembers(groupId, 1);
}

export async function setMemberRole(groupId: string, userId: string, role: GroupRole): Promise<void> {
  const { error } = await db.from("group_members").update({ role }).eq("group_id", groupId).eq("user_id", userId);
  if (error) throw error;
}

/** Admin action: remove (and optionally ban) a member. */
export async function removeMember(
  groupId: string,
  userId: string,
  opts: { ban?: boolean; role?: GroupRole } = {},
): Promise<void> {
  if (opts.ban) {
    await setMemberRole(groupId, userId, "banned");
  } else {
    const { error } = await db.from("group_members").delete().eq("group_id", groupId).eq("user_id", userId);
    if (error) throw error;
  }
  if (opts.role === "member" || opts.role === "moderator") await bumpMembers(groupId, -1);
}

export async function createGroupPost(input: {
  groupId: string;
  userId: string;
  username: string;
  caption?: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
}): Promise<GroupPost> {
  const caption = input.caption?.trim() || null;
  if (!caption && !input.imageUrl && !input.videoUrl) {
    throw new Error("Add a caption, photo or video first.");
  }
  const { data, error } = await db
    .from("group_posts")
    .insert({
      group_id: input.groupId,
      user_id: input.userId,
      username: input.username,
      caption,
      image_url: input.imageUrl || null,
      video_url: input.videoUrl || null,
      likes: 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as GroupPost;
}

export async function likeGroupPost(post: GroupPost, liked: boolean): Promise<number> {
  const next = Math.max(0, (post.likes ?? 0) + (liked ? 1 : -1));
  const { error } = await db.from("group_posts").update({ likes: next }).eq("id", post.id);
  if (error) throw error;
  return next;
}

export async function deleteGroupPost(postId: string): Promise<void> {
  const { error } = await db.from("group_posts").delete().eq("id", postId);
  if (error) throw error;
}

async function bumpMembers(groupId: string, delta: number) {
  const { data } = await db.from("groups").select("members_count").eq("id", groupId).maybeSingle();
  const current = (data?.members_count as number | undefined) ?? 0;
  await db
    .from("groups")
    .update({ members_count: Math.max(0, current + delta) })
    .eq("id", groupId);
}

/* ------------------------------------------------------------------ */
/* Media                                                               */
/* ------------------------------------------------------------------ */

/**
 * Group images live in the public "videos" storage bucket (the same bucket
 * already used for marketplace photos and stories), under a groups/ prefix.
 */
export async function uploadGroupImage(file: File, userId: string, kind: "cover" | "avatar"): Promise<string> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/groups/${kind}-${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from("videos").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return supabase.storage.from("videos").getPublicUrl(path).data.publicUrl;
}

/** Upload a photo or video for a group post. */
export async function uploadGroupMedia(
  file: File,
  userId: string,
): Promise<{ url: string; kind: "image" | "video" }> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/groups/post-${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from("videos").upload(path, file, { contentType: file.type });
  if (error) throw error;
  return {
    url: supabase.storage.from("videos").getPublicUrl(path).data.publicUrl,
    kind: file.type.startsWith("video/") ? "video" : "image",
  };
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function isActiveMember(role?: GroupRole | null): boolean {
  return role === "admin" || role === "moderator" || role === "member";
}

export function isAdmin(role?: GroupRole | null): boolean {
  return role === "admin";
}

export function canModerate(role?: GroupRole | null): boolean {
  return role === "admin" || role === "moderator";
}

export function formatMembers(n: number | null | undefined): string {
  const count = n ?? 0;
  return `${count.toLocaleString()} ${count === 1 ? "member" : "members"}`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const secs = Math.max(1, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
