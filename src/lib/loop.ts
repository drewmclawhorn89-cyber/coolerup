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
  /** Sound this video plays (null/undefined = its own original audio). */
  sound_id?: string | null;
  /** Embedded sound row when the feed joins `sounds`. */
  sound?: SoundSummary | null;
};

/** Minimal sound shape embedded in feed rows. */
export type SoundSummary = {
  id: string;
  original_video_id: string;
  audio_url: string;
  title: string;
  creator_username: string;
  uses_count: number;
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

/** Fisher–Yates shuffle, in place. */
function shuffle<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = list[i]!;
    const b = list[j]!;
    list[i] = b;
    list[j] = a;
  }
  return list;
}

/**
 * Shuffled order of every video in the library, built once per app session.
 *
 * The feed used to page through videos newest-first and only shuffle within
 * that single page, so every visit showed the same handful of recent uploads.
 * We now pull every video id (tiny payload), shuffle the whole library, and
 * hand out batches from that order. Reloading the app builds a fresh shuffle,
 * so the mix is different every time you open it.
 */
let feedOrder: string[] | null = null;
let feedOrderPromise: Promise<string[]> | null = null;

const ID_PAGE_SIZE = 1000;

async function loadVideoIds(): Promise<string[]> {
  const ids: string[] = [];
  for (let from = 0; ; from += ID_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("videos")
      .select("id")
      .order("id", { ascending: true })
      .range(from, from + ID_PAGE_SIZE - 1);
    if (error) throw error;
    const batch = (data ?? []).map((row) => row.id as string);
    ids.push(...batch);
    if (batch.length < ID_PAGE_SIZE) break;
  }
  return shuffle(ids);
}

async function getFeedOrder(): Promise<string[]> {
  if (feedOrder) return feedOrder;
  if (!feedOrderPromise) {
    feedOrderPromise = loadVideoIds()
      .then((ids) => {
        feedOrder = ids;
        return ids;
      })
      .finally(() => {
        feedOrderPromise = null;
      });
  }
  return feedOrderPromise;
}

/** Forget the current shuffle so the next fetch builds a new random order. */
export function resetFeedOrder() {
  feedOrder = null;
  feedOrderPromise = null;
}

export async function fetchVideos(page = 0, pageSize = 20) {
  const PAGE_SIZE = Math.max(1, Math.min(50, pageSize));
  const order = await getFeedOrder();
  const from = page * PAGE_SIZE;
  const ids = order.slice(from, from + PAGE_SIZE);
  if (ids.length === 0) return [] as Video[];

  // Select only the columns the feed renders (smaller payload, faster parse).
  const { data, error } = await supabase
    .from("videos")
    .select(
      "id, username, caption, video_url, likes_count, comments_count, shares_count, reposts_count, created_at, sound_id, sounds(id, original_video_id, audio_url, title, creator_username, uses_count)",
    )
    .in("id", ids);

  if (error) throw error;

  // `.in()` does not preserve order, so re-apply the shuffled queue order.
  const byId = new Map((data ?? []).map((v) => [v.id as string, v]));
  return ids
    .map((id) => byId.get(id))
    .filter((v): v is NonNullable<typeof v> => !!v)
    .map((v) => ({
      ...v,
      reposts: v.reposts_count ?? 0,
      sound: ((v as { sounds?: SoundSummary | null }).sounds ?? null) as SoundSummary | null,
    })) as Video[];
}

/**
 * Fresh engagement counters for a set of videos.
 *
 * Offline-saved videos keep a snapshot of the row they were saved from, so
 * their like/repost counts freeze at save time. The saved tab uses this to
 * reconcile those snapshots with the live numbers.
 */
export async function fetchVideoCounts(ids: string[]) {
  const unique = [...new Set(ids)].filter(Boolean);
  const counts = new Map<
    string,
    { likes_count: number; comments_count: number; shares_count: number; reposts_count: number }
  >();
  if (unique.length === 0) return counts;
  const { data } = await supabase
    .from("videos")
    .select("id, likes_count, comments_count, shares_count, reposts_count")
    .in("id", unique);
  for (const row of data ?? []) {
    counts.set(row.id, {
      likes_count: row.likes_count ?? 0,
      comments_count: row.comments_count ?? 0,
      shares_count: row.shares_count ?? 0,
      reposts_count: row.reposts_count ?? 0,
    });
  }
  return counts;
}

export async function fetchMyLikes() {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set<string>();
  const { data } = await supabase.from("likes").select("video_id").eq("user_id", user.id);
  return new Set((data ?? []).map((l) => l.video_id));
}

/**
 * Persist an uploaded video/photo. Returns the new video id.
 *
 * `soundId` attaches a borrowed original sound ("Use this sound"). Every video
 * also gets its own original-sound row via `create_sound_from_video`.
 */
export async function uploadVideo(
  file: File,
  username: string,
  caption: string,
  song?: Song | null,
  full = false,
  soundId?: string | null,
): Promise<string | null> {
  const ext = file.name.split(".").pop() || "mp4";
  const path = `${crypto.randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, file, { contentType: file.type });
  if (upErr) throw upErr;
  const isVideo = file.type.startsWith("video/");
  const { data, error } = await supabase
    .from("videos")
    .insert({
      username,
      caption:
        withSong(caption, file.type.startsWith("image/") ? song : null) +
        (full && isVideo ? "[[full]]" : ""),
      video_url: STORAGE_PREFIX + path,
      sound_id: isVideo ? (soundId ?? null) : null,
    })
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id?: string } | null)?.id ?? null;
  if (id && isVideo) await ensureOriginalSound(id);
  return id;
}

export async function uploadRecording(
  blob: Blob,
  username: string,
  caption: string,
  soundId?: string | null,
): Promise<string | null> {
  const contentType = blob.type || "video/webm";
  const ext = contentType.includes("mp4") ? "mp4" : "webm";
  const path = `recorded-${Date.now()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from("videos")
    .upload(path, blob, { contentType });
  if (upErr) throw upErr;
  const { data, error } = await supabase
    .from("videos")
    .insert({ username, caption, video_url: STORAGE_PREFIX + path, sound_id: soundId ?? null })
    .select("id")
    .single();
  if (error) throw error;
  const id = (data as { id?: string } | null)?.id ?? null;
  if (id) await ensureOriginalSound(id);
  return id;
}

/** Ask the database to create this video's own "Original sound" row. */
async function ensureOriginalSound(videoId: string) {
  try {
    await supabase.rpc("create_sound_from_video", { _video_id: videoId });
  } catch {
    // Non-fatal: the INSERT trigger also creates the sound.
  }
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
