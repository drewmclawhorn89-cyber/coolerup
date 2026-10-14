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
    .createSignedUrl(url.slice(STORAGE_PREFIX.length), 60 * 60 * 24 * 7);
  return data?.signedUrl ?? "";
}

export async function fetchVideos() {
  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(300);
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
  const id = crypto.randomUUID();
  
  // Upload original as 1080p
  const path1080 = `${id}_1080.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path1080, file, { contentType: file.type });
  if (upErr) throw upErr;

  // For now, use same file for 720p and 480p (same URL, but later you can compress)
  // This makes the quality switcher work TODAY without needing a transcoding server
  const path720 = `${id}_720.${ext}`;
  const path480 = `${id}_480.${ext}`;

  // Copy same file as placeholder - replace later with real transcoding
  await supabase.storage.from("videos").copy(path1080, path720);
  await supabase.storage.from("videos").copy(path1080, path480);

  const { error } = await supabase
    .from("videos")
    .insert({ 
      username, 
      caption, 
      video_url: STORAGE_PREFIX + path1080,
      video_url_720: STORAGE_PREFIX + path720,
      video_url_480: STORAGE_PREFIX + path480
    });
  if (error) throw error;
}

// Add this helper to get right URL based on signal/choice
export function getQualityUrl(video: any, quality: '1080p' | '720p' | '480p') {
  if (quality === '720p') return video.video_url_720 || video.video_url;
  if (quality === '480p') return video.video_url_480 || video.video_url;
  return video.video_url; // 1080p
}
  const path = `${crypto.randomUUID()}.${ext}`;
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
