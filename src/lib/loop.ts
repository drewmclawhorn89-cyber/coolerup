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
  is_live?: boolean | null;
};

export type Song = { id: string; title: string; artist: string };

const SONG_TAG = /\s*\[\[song:([^|\]]+)\|([^|\]]*)\|([^\]]*)\]\]\s*$/;

export function songStreamUrl(id: string) {
  return `https://api.audius.co/v1/tracks/${id}/stream?app_name=coolerup`;
}

export function withSong(caption: string, song?: Song | null) {
  if (!song) return caption;
  const clean = (v: string) => v.replace(/[|\[\]]/g, "").slice(0, 80);
  return `${caption}[[song:${song.id}|${clean(song.title)}|${clean(song.artist)}]]`;
}

export function parseCaption(caption: string): { text: string; song: Song | null } {
  const m = caption.match(SONG_TAG);
  if (!m) return { text: caption, song: null };
  return { text: caption.replace(SONG_TAG, ""), song: { id: m[1] ?? "", title: m[2] ?? "", artist: m[3] ?? "" } };
}

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

export async function fetchVideos(page = 0) {
  const PAGE_SIZE = 20;
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .range(from, to);

  if (error) throw error;
  return (data as Video[]).sort(() => Math.random() - 0.6);
}

export async function fetchMyLikes() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return new Set<string>();
  const { data } = await supabase.from("likes").select("video_id").eq("user_id", user.id);
  return new Set((data ?? []).map((l) => l.video_id));
}

export async function uploadVideo(file: File, username: string, caption: string, song?: Song | null) {
  const ext = file.name.split(".").pop() || "mp4";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, file, { contentType: file.type });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("videos")
    .insert({ username, caption: withSong(caption, file.type.startsWith("image/") ? song : null), video_url: STORAGE_PREFIX + path });
  if (error) throw error;
}

export async function uploadRecording(blob: Blob, username: string, caption: string) {
  const contentType = blob.type || "video/webm";
  const ext = contentType.includes("mp4") ? "mp4" : "webm";
  const path = `recorded-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, blob, { contentType });
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

export async function setVideoSaved(videoId: string, on: boolean) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  if (on) await supabase.from("saved_videos").upsert({ user_id: user.id, video_id: videoId });
  else await supabase.from("saved_videos").delete().eq("user_id", user.id).eq("video_id", videoId);
}

export async function fetchSavedVideos(userId: string) {
  const { data } = await supabase
    .from("saved_videos")
    .select("created_at, videos(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as any[]).map((r) => r.videos).filter(Boolean);
}
