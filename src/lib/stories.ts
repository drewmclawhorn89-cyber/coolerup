import { supabase } from "@/integrations/supabase/client";
import { notifyUser } from "@/lib/notify";
import { resolveVideoUrl } from "@/lib/loop";

export type Story = {
  id: string;
  username: string;
  media_url: string;
  media_type: "image" | "video";
  created_at: string;
  expires_at: string;
  likes_count?: number | null;
};

const STORY_PREFIX = "storage:";
const db = supabase as any;

export async function fetchStories(username: string): Promise<Story[]> {
  const { data, error } = await db
    .from("stories")
    .select("*")
    .eq("username", username)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Story[];
}

export async function postStory(file: File, username: string) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to post a story");
  const type = file.type.startsWith("video/") ? "video" : "image";
  const ext = file.name.split(".").pop() || (type === "video" ? "mp4" : "jpg");
  const path = `stories/${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage.from("videos").upload(path, file, { contentType: file.type });
  if (upErr) throw upErr;
  const { error } = await db.from("stories").insert({
    user_id: user.id,
    username,
    media_type: type,
    media_url: STORY_PREFIX + path,
  });
  if (error) throw error;
}

export async function deleteStory(id: string) {
  const { error } = await db.from("stories").delete().eq("id", id);
  if (error) throw error;
}

/** Story ids the signed-in user has already hearted. */
export async function fetchLikedStoryIds(): Promise<Set<string>> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set<string>();
  const { data } = await db.from("story_likes").select("story_id").eq("user_id", user.id);
  return new Set(((data ?? []) as { story_id: string }[]).map((r) => r.story_id));
}

/**
 * Persist a story heart. Returns the new liked state so the caller can keep its
 * optimistic UI honest if the write fails.
 */
export async function setStoryLiked(story: Story, liked: boolean): Promise<boolean> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Sign in to like stories");

  if (liked) {
    const { error } = await db.from("story_likes").insert({ story_id: story.id, user_id: user.id });
    // 23505 = already liked, which is fine.
    if (error && error.code !== "23505") throw error;

    if (story.username) {
      const { data: owner } = await supabase
        .from("profiles")
        .select("id, handle")
        .eq("handle", story.username)
        .maybeSingle();
      if (owner && owner.id !== user.id) {
        const { data: me } = await supabase.from("profiles").select("handle").eq("id", user.id).maybeSingle();
        await notifyUser({
          targetUserId: owner.id,
          actorUserId: user.id,
          type: "story_like",
          text: `${me?.handle ?? "Someone"} liked your story`,
          url: "/",
        });
      }
    }
  } else {
    const { error } = await db.from("story_likes").delete().eq("story_id", story.id).eq("user_id", user.id);
    if (error) throw error;
  }
  return liked;
}

export const resolveStoryUrl = resolveVideoUrl;
