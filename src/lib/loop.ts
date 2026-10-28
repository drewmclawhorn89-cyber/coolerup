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
  /** Repost count, kept in sync with the `reposts` table. */
  reposts?: number;
  /** Raw column name returned by `select("*")` on the videos table. */
  reposts_count?: number;
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

const FULL_TAG = /\s*\[\[full\]\]\s*$/;

export function parseCaption(raw: string): { text: string; song: Song | null; full: boolean } {
  const full = FULL_TAG.test(raw);
  const caption = full ? raw.replace(FULL_TAG, "") : raw;
  const m = caption.match(SONG_TAG);
  if (!m) return { text: caption, song: null, full };
  return {
    text: caption.replace(SONG_TAG, ""),
    song: { id: m[1] ?? "", title: m[2] ?? "", artist: m[3] ?? "" },
    full,
  };
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

export async function fetchVideos(page = 0, pageSize = 20) {
  const PAGE_SIZE = Math.max(1, Math.min(50, pageSize));
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  // Select only the columns the feed renders (smaller payload, faster parse).
  const { data, error } = await supabase
    .from("videos")
    .select(
      "id, username, caption, video_url, likes_count, comments_count, shares_count, reposts_count, created_at",
    )
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) throw error;
  // Fisher–Yates shuffle for feed variety (the old sort comparator was invalid).
  const list = (data ?? []).map((v) => ({ ...v, reposts: v.reposts_count ?? 0 })) as Video[];
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = list[i]!;
    const b = list[j]!;
    list[i] = b;
    list[j] = a;
  }
  return list;
}

export async function fetchMyLikes() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set<string>();
  const { data } = await supabase.from("likes").select("video_id").eq("user_id", user.id);
  return new Set((data ?? []).map((l) => l.video_id));
}

export async function uploadVideo(
  file: File,
  username: string,
  caption: string,
  song?: Song | null,
  full = false,
) {
  const ext = file.name.split(".").pop() || "mp4";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, file, { contentType: file.type });
  if (upErr) throw upErr;
  const { error } = await supabase
    .from("videos")
    .insert({
      username,
      caption:
        withSong(caption, file.type.startsWith("image/") ? song : null) +
        (full && file.type.startsWith("video/") ? "[[full]]" : ""),
      video_url: STORAGE_PREFIX + path,
    });
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
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  if (on) await supabase.from("saved_videos").insert({ user_id: user.id, video_id: videoId });
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

/** Videos a user has liked, newest like first (for the profile Liked tab). */
export async function fetchLikedVideos(userId: string) {
  const { data } = await supabase
    .from("likes")
    .select("created_at, videos(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as { videos: Video | null }[])
    .map((r) => r.videos)
    .filter((v): v is Video => !!v);
}

/** Videos a user has reposted, newest repost first (for the profile Reposts tab). */
export async function fetchRepostedVideos(userId: string) {
  const { data } = await supabase
    .from("reposts")
    .select("created_at, videos(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return ((data ?? []) as unknown as { videos: Video | null }[])
    .map((r) => r.videos)
    .filter((v): v is Video => !!v)
    .map((v) => ({ ...v, reposts: v.reposts_count ?? 0 }));
}

/** Reposts made by the people a user follows, for the Following feed. */
export async function fetchRepostsByHandles(handles: string[]) {
  if (handles.length === 0) return [] as Video[];
  const { data: profiles } = await supabase.from("profiles").select("id").in("handle", handles);
  const ids = (profiles ?? []).map((p) => p.id);
  if (ids.length === 0) return [] as Video[];
  const { data } = await supabase
    .from("reposts")
    .select("created_at, videos(*)")
    .in("user_id", ids)
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as unknown as { videos: Video | null }[])
    .map((r) => r.videos)
    .filter((v): v is Video => !!v)
    .map((v) => ({ ...v, reposts: v.reposts_count ?? 0 }));
}

export async function deleteVideo(video: Video) {
  const { error } = await supabase.from("videos").delete().eq("id", video.id);
  if (error) throw error;
  if (video.video_url.startsWith(STORAGE_PREFIX)) {
    await supabase.storage.from("videos").remove([video.video_url.slice(STORAGE_PREFIX.length)]);
  }
}
