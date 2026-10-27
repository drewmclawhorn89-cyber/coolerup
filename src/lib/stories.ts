import { supabase } from "@/integrations/supabase/client";
import { resolveVideoUrl } from "@/lib/loop";

export type Story = {
  id: string;
  username: string;
  media_url: string;
  media_type: "image" | "video";
  created_at: string;
  expires_at: string;
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

export const resolveStoryUrl = resolveVideoUrl;
