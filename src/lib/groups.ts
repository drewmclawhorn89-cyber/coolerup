import { supabase } from "@/integrations/supabase/client";

// The groups tables are new, so they aren't in the generated Database type yet.
// Every query goes through this untyped handle (same pattern as Marketplace).
const db = supabase as any;

export type GroupPrivacy = "public" | "private";
export type GroupRole = "admin" | "moderator" | "member";

export type Group = {
  id: string;
  name: string;
  description: string | null;
  cover_image: string | null;
  avatar_image: string | null;
  privacy: GroupPrivacy;
  creator_id: string;
  creator_username: string | null;
  created_at: string;
  members_count: number;
};

export type GroupMember = {
  id: string;
  group_id: string;
  user_id: string;
  username: string | null;
  role: GroupRole;
  joined_at: string;
};

export type GroupPost = {
  id: string;
  group_id: string;
  user_id: string;
  username: string | null;
  caption: string | null;
  video_url: string | null;
  image_url: string | null;
  created_at: string;
  likes: number;
};

export type GroupJoinRequest = {
  id: string;
  group_id: string;
  user_id: string;
  username: string | null;
  status: "pending" | "approved" | "denied";
  created_at: string;
};

const GROUP_COLUMNS =
  "id, name, description, cover_image, avatar_image, privacy, creator_id, creator_username, created_at, members_count";

function clean(value: string) {
  return value.replace(/[%,()]/g, "").trim();
}

export async function listGroups(opts: { search?: string; limit?: number } = {}): Promise<Group[]> {
  let q = db.from("groups").select(GROUP_COLUMNS).order("members_count", { ascending: false });
  const search = clean(opts.search ?? "");
  if (search) q = q.or(`name.ilike.%${search}%,description.ilike.%${search}%`);
  const { data, error } = await q.limit(opts.limit ?? 60);
  if (error) throw error;
  return (data ?? []) as Group[];
}

export async function getGroup(id: string): Promise<Group | null> {
  const { data, error } = await db.from("groups").select(GROUP_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as Group | null;
}

export async function listMyGroups(userId: string): Promise<Group[]> {
  const { data: memberships, error } = await db
    .from("group_members")
    .select("group_id")
    .eq("user_id", userId);
  if (error) throw error;
  const ids = (memberships ?? []).map((m: { group_id: string }) => m.group_id);
  if (ids.length === 0) return [];
  const { data, error: groupErr } = await db
    .from("groups")
    .select(GROUP_COLUMNS)
    .in("id", ids)
    .order("members_count", { ascending: false });
  if (groupErr) throw groupErr;
  return (data ?? []) as Group[];
}

export async function listMembers(groupId: string): Promise<GroupMember[]> {
  const { data, error } = await db
    .from("group_members")
    .select("id, group_id, user_id, username, role, joined_at")
    .eq("group_id", groupId)
    .order("joined_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GroupMember[];
}

export async function getMyMembership(
  groupId: string,
  userId: string,
): Promise<GroupMember | null> {
  const { data, error } = await db
    .from("group_members")
    .select("id, group_id, user_id, username, role, joined_at")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data ?? null) as GroupMember | null;
}

export async function getMyJoinRequest(
  groupId: string,
  userId: string,
): Promise<GroupJoinRequest | null> {
  const { data, error } = await db
    .from("group_join_requests")
    .select("id, group_id, user_id, username, status, created_at")
    .eq("group_id", groupId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return null;
  return (data ?? null) as GroupJoinRequest | null;
}

export async function listJoinRequests(groupId: string): Promise<GroupJoinRequest[]> {
  const { data, error } = await db
    .from("group_join_requests")
    .select("id, group_id, user_id, username, status, created_at")
    .eq("group_id", groupId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as GroupJoinRequest[];
}

export async function uploadGroupImage(
  file: File,
  userId: string,
  kind: "cover" | "avatar",
): Promise<string> {
  const ext =
    file.name
      .split(".")
      .pop()
      ?.replace(/[^a-zA-Z0-9]/g, "") || "jpg";
  const path = `${userId}/${kind}-${Date.now()}.${ext}`;
  let bucket = "groups";
  let up = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (up.error) {
    // Older projects may not have the groups bucket yet — fall back to videos.
    bucket = "videos";
    up = await supabase.storage
      .from(bucket)
      .upload(`groups/${path}`, file, { contentType: file.type, upsert: true });
  }
  if (up.error) throw up.error;
  const key = bucket === "videos" ? `groups/${path}` : path;
  return supabase.storage.from(bucket).getPublicUrl(key).data.publicUrl;
}

export async function createGroup(input: {
  name: string;
  description: string;
  privacy: GroupPrivacy;
  coverFile: File | null;
  avatarFile: File | null;
  userId: string;
  username: string;
}): Promise<string> {
  const { name, description, privacy, coverFile, avatarFile, userId, username } = input;
  const [cover_image, avatar_image] = await Promise.all([
    coverFile ? uploadGroupImage(coverFile, userId, "cover") : Promise.resolve(null),
    avatarFile ? uploadGroupImage(avatarFile, userId, "avatar") : Promise.resolve(null),
  ]);

  const { data, error } = await db
    .from("groups")
    .insert({
      name: name.trim(),
      description: description.trim() || null,
      privacy,
      cover_image,
      avatar_image,
      creator_id: userId,
      creator_username: username,
      members_count: 0,
    })
    .select("id")
    .single();
  if (error) throw error;
  const groupId = data.id as string;

  // Creator joins as admin. The members_count trigger bumps the counter.
  const { error: memberErr } = await db
    .from("group_members")
    .insert({ group_id: groupId, user_id: userId, username, role: "admin" });
  if (memberErr) throw memberErr;

  // Safety net for projects where the count trigger isn't installed yet.
  await db.from("groups").update({ members_count: 1 }).eq("id", groupId).eq("members_count", 0);

  return groupId;
}

export async function joinGroup(groupId: string, userId: string, username: string) {
  const { error } = await db
    .from("group_members")
    .insert({ group_id: groupId, user_id: userId, username, role: "member" });
  if (error && !`${error.message}`.toLowerCase().includes("duplicate")) throw error;
}

export async function leaveGroup(groupId: string, userId: string) {
  const { error } = await db
    .from("group_members")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function requestToJoin(groupId: string, userId: string, username: string) {
  const { error } = await db
    .from("group_join_requests")
    .upsert(
      { group_id: groupId, user_id: userId, username, status: "pending" },
      { onConflict: "group_id,user_id" },
    );
  if (error) throw error;
}

export async function cancelJoinRequest(groupId: string, userId: string) {
  const { error } = await db
    .from("group_join_requests")
    .delete()
    .eq("group_id", groupId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function approveJoinRequest(request: GroupJoinRequest) {
  await joinGroup(request.group_id, request.user_id, request.username ?? "member");
  const { error } = await db
    .from("group_join_requests")
    .update({ status: "approved" })
    .eq("id", request.id);
  if (error) throw error;
}

export async function denyJoinRequest(requestId: string) {
  const { error } = await db
    .from("group_join_requests")
    .update({ status: "denied" })
    .eq("id", requestId);
  if (error) throw error;
}

export async function setMemberRole(memberId: string, role: GroupRole) {
  const { error } = await db.from("group_members").update({ role }).eq("id", memberId);
  if (error) throw error;
}

export async function removeMember(memberId: string) {
  const { error } = await db.from("group_members").delete().eq("id", memberId);
  if (error) throw error;
}

export async function listGroupPosts(groupId: string, limit = 40): Promise<GroupPost[]> {
  const { data, error } = await db
    .from("group_posts")
    .select("id, group_id, user_id, username, caption, video_url, image_url, created_at, likes")
    .eq("group_id", groupId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as GroupPost[];
}

export async function createGroupPost(input: {
  groupId: string;
  userId: string;
  username: string;
  caption: string;
  file: File | null;
}) {
  const { groupId, userId, username, caption, file } = input;
  let video_url: string | null = null;
  let image_url: string | null = null;

  if (file) {
    const ext =
      file.name
        .split(".")
        .pop()
        ?.replace(/[^a-zA-Z0-9]/g, "") || "mp4";
    const path = `${userId}/group-${Date.now()}.${ext}`;
    let bucket = "videos";
    let up = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
    if (up.error) {
      bucket = "groups";
      up = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type });
    }
    if (up.error) throw up.error;
    const url = supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    if (file.type.startsWith("video/")) video_url = url;
    else image_url = url;
  }

  if (!caption.trim() && !video_url && !image_url) throw new Error("Add a caption, photo or video");

  const { error } = await db.from("group_posts").insert({
    group_id: groupId,
    user_id: userId,
    username,
    caption: caption.trim() || null,
    video_url,
    image_url,
    likes: 0,
  });
  if (error) throw error;
}

export async function deleteGroupPost(postId: string) {
  const { error } = await db.from("group_posts").delete().eq("id", postId);
  if (error) throw error;
}

export async function likeGroupPost(post: GroupPost) {
  const { error } = await db
    .from("group_posts")
    .update({ likes: (post.likes ?? 0) + 1 })
    .eq("id", post.id);
  if (error) throw error;
}

export async function updateGroup(
  groupId: string,
  patch: { name?: string; description?: string | null; privacy?: GroupPrivacy },
) {
  const { error } = await db.from("groups").update(patch).eq("id", groupId);
  if (error) throw error;
}

export async function deleteGroup(groupId: string) {
  const { error } = await db.from("groups").delete().eq("id", groupId);
  if (error) throw error;
}

export function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString();
}
