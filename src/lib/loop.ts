import { supabase } from "@/integrations/supabase/client";

export type Video = {
  id: string;
  username: string;
  caption: string;
  video_url: string;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  created_at: string;
};

const STORAGE_PREFIX = "storage:";

export function getDeviceId() {
  let id = localStorage.getItem("loop-device");
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem("loop-device", id);
  }
  return id;
}

export function isImageUrl(url: string) {
  return /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i.test(url);
}

export async function resolveVideoUrl(url: string) {
  if (!url.startsWith(STORAGE_PREFIX)) return url;
  const { data } = await supabase.storage
    .from("videos")
    .createSignedUrl(url.slice(STORAGE_PREFIX.length), 60 * 60 * 6);
  return data?.signedUrl ?? "";
}

export async function fetchVideos() {
  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data as Video[];
}

export async function fetchMyLikes() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set<string>();
  const { data } = await supabase.from("likes").select("video_id").eq("user_id", user.id);
  return new Set((data ?? []).map((l) => l.video_id));
}

export async function uploadVideo(file: File, username: string, caption: string) {
  const ext = file.name.split(".").pop() || "mp4";
  const path = `${crypto.randomUUID()}.${ext}`;
  export async function uploadVideo(file) {
  const ext = file.name.split(".").pop()
  const path = `${crypto.randomUUID()}.${ext}`
  
  // 1. you already have this part - upload to storage
  const { data, error } = await supabase.storage.from("videos").upload(path, file)
  if (error) throw error

  // 2. you already have this part - get the url
  const { data: urlData } = supabase.storage.from("videos").getPublicUrl(path)
  const publicUrl = urlData.publicUrl

  // 3. ADD THIS NEW PART HERE - right here, before you save to the table
  const videoData = {
    url: publicUrl,
    url_1080: publicUrl, // same file for now, we will make it low quality later
    url_360: publicUrl,  // same file for now
    // url: publicUrl, // keep your old field so your current VideoCard still works
  }

  // 4. then you save to database - you already have something like this:
  const { data: videoRow } = await supabase.from("videos").insert(videoData).select().single()

  return videoRow
}
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, file, { contentType: file.type });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("videos")
    .insert({ username, caption, video_url: STORAGE_PREFIX + path });
  if (error) throw error;
}

export function formatCount(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}
