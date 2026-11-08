import { supabase } from "@/integrations/supabase/client";

/**
 * Long-form ("YouTube style") videos.
 *
 * These are deliberately separate from `videos` in lib/loop.ts: that table
 * drives the vertical TikTok feed, this one drives the horizontal grid at
 * /videos and the watch page at /watch/:id. Different limits (60 minutes vs
 * 60 seconds), different player, different layout.
 *
 * The generated Supabase types don't know about these tables yet, so queries
 * go through a loosely typed handle — same approach as lib/groups.ts.
 */
const db = supabase as any;

/** Hard cap for a full-length upload: 60 minutes, like YouTube's default. */
export const MAX_FULL_VIDEO_SECONDS = 60 * 60;

/** Storage bucket used for both the video file and its thumbnail. */
export const FULL_VIDEO_BUCKET = "videos";

export type FullVideo = {
  id: string;
  user_id: string;
  username: string;
  title: string;
  description: string;
  video_url: string;
  thumbnail_url: string | null;
  duration: number;
  views: number;
  category: string;
  tags: string[];
  video_1080_url?: string | null;
  video_720_url?: string | null;
  video_480_url?: string | null;
  created_at: string;
};

export type FullVideoComment = {
  id: string;
  video_id: string;
  user_id: string | null;
  username: string;
  body: string;
  created_at: string;
};

export type Reaction = "like" | "dislike";

/** Category chips shown above the grid, in order. */
export const FULL_VIDEO_CATEGORIES = [
  "All",
  "Music",
  "Gaming",
  "Christmas",
  "Funny",
  "LIVE Replays",
] as const;

export type FullVideoCategory = (typeof FULL_VIDEO_CATEGORIES)[number];

const STORAGE_PREFIX = "storage:";

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/** 3725 -> "1:02:05", 754 -> "12:34". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

export function formatViews(n: number): string {
  const v = Number(n) || 0;
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B views`;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, "")}M views`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1).replace(/\.0$/, "")}K views`;
  return `${v} ${v === 1 ? "view" : "views"}`;
}

/** "2 days ago" — the compact relative stamp YouTube shows under a title. */
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Math.max(0, Date.now() - then);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;
  const month = 30 * day;
  const year = 365 * day;

  if (diff < minute) return "just now";
  if (diff < hour) {
    const n = Math.floor(diff / minute);
    return `${n} ${n === 1 ? "minute" : "minutes"} ago`;
  }
  if (diff < day) {
    const n = Math.floor(diff / hour);
    return `${n} ${n === 1 ? "hour" : "hours"} ago`;
  }
  if (diff < week) {
    const n = Math.floor(diff / day);
    return `${n} ${n === 1 ? "day" : "days"} ago`;
  }
  if (diff < month) {
    const n = Math.floor(diff / week);
    return `${n} ${n === 1 ? "week" : "weeks"} ago`;
  }
  if (diff < year) {
    const n = Math.floor(diff / month);
    return `${n} ${n === 1 ? "month" : "months"} ago`;
  }
  const n = Math.floor(diff / year);
  return `${n} ${n === 1 ? "year" : "years"} ago`;
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export type ListOptions = {
  category?: string;
  search?: string;
  limit?: number;
};

/**
 * Grid query. Category "All" (or empty) means no category filter. Search runs
 * across title, username and description with a single ilike OR clause.
 */
export async function listFullVideos(opts: ListOptions = {}): Promise<FullVideo[]> {
  const { category, search, limit = 60 } = opts;
  let query = db.from("full_videos").select("*").order("created_at", { ascending: false }).limit(limit);

  if (category && category !== "All") query = query.eq("category", category);

  const term = search?.trim();
  if (term) {
    // Escape PostgREST's `or` separators so a comma in the query can't break it.
    const safe = term.replace(/[%,()]/g, " ").trim();
    if (safe) {
      query = query.or(
        `title.ilike.%${safe}%,username.ilike.%${safe}%,description.ilike.%${safe}%`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as FullVideo[];
}

export async function getFullVideo(id: string): Promise<FullVideo | null> {
  const { data, error } = await db.from("full_videos").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data ?? null) as FullVideo | null;
}

/** Related videos for the "Up Next" rail: same category first, then recent. */
export async function listRelatedVideos(video: FullVideo, limit = 12): Promise<FullVideo[]> {
  const { data, error } = await db
    .from("full_videos")
    .select("*")
    .neq("id", video.id)
    .order("created_at", { ascending: false })
    .limit(limit * 2);
  if (error) throw error;

  const rows = (data ?? []) as FullVideo[];
  // Same-category matches float to the top, keeping recency within each group.
  return [...rows]
    .sort((a, b) => {
      const aMatch = a.category === video.category ? 0 : 1;
      const bMatch = b.category === video.category ? 0 : 1;
      return aMatch - bMatch;
    })
    .slice(0, limit);
}

export async function listMyFullVideos(userId: string): Promise<FullVideo[]> {
  const { data, error } = await db
    .from("full_videos")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FullVideo[];
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/**
 * Fire-and-forget view bump. Uses a SECURITY DEFINER RPC so signed-out viewers
 * can increment the counter without being able to edit the row.
 */
export async function incrementFullVideoViews(videoId: string): Promise<void> {
  try {
    await db.rpc("increment_full_video_views", { video_id: videoId });
  } catch {
    /* A missed view is not worth breaking the page for. */
  }
}

/* ------------------------------------------------------------------ */
/* Likes / dislikes                                                    */
/* ------------------------------------------------------------------ */

export type ReactionCounts = { likes: number; dislikes: number };

export async function getReactionCounts(videoId: string): Promise<ReactionCounts> {
  const { data, error } = await db
    .from("full_video_likes")
    .select("reaction")
    .eq("video_id", videoId);
  if (error) throw error;
  const rows = (data ?? []) as { reaction: Reaction }[];
  return {
    likes: rows.filter((r) => r.reaction === "like").length,
    dislikes: rows.filter((r) => r.reaction === "dislike").length,
  };
}

export async function getMyReaction(videoId: string, userId: string): Promise<Reaction | null> {
  const { data, error } = await db
    .from("full_video_likes")
    .select("reaction")
    .eq("video_id", videoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return ((data as { reaction: Reaction } | null)?.reaction ?? null);
}

/**
 * Toggle a reaction. Tapping the same button twice clears it; tapping the other
 * one switches. Returns the resulting state so the caller can update the UI.
 */
export async function setReaction(
  videoId: string,
  userId: string,
  next: Reaction | null,
): Promise<void> {
  if (!next) {
    const { error } = await db
      .from("full_video_likes")
      .delete()
      .eq("video_id", videoId)
      .eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const { error } = await db
    .from("full_video_likes")
    .upsert({ video_id: videoId, user_id: userId, reaction: next }, { onConflict: "video_id,user_id" });
  if (error) throw error;
}

/* ------------------------------------------------------------------ */
/* Comments                                                            */
/* ------------------------------------------------------------------ */

export async function listComments(videoId: string): Promise<FullVideoComment[]> {
  const { data, error } = await db
    .from("full_video_comments")
    .select("*")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as FullVideoComment[];
}

export async function addComment(
  videoId: string,
  userId: string,
  username: string,
  body: string,
): Promise<FullVideoComment> {
  const { data, error } = await db
    .from("full_video_comments")
    .insert({ video_id: videoId, user_id: userId, username, body: body.trim() })
    .select("*")
    .single();
  if (error) throw error;
  return data as FullVideoComment;
}

/* ------------------------------------------------------------------ */
/* Editing an existing upload                                          */
/* ------------------------------------------------------------------ */

export type FullVideoEdit = {
  title: string;
  description: string;
  category: string;
  tags: string[];
  /** New `storage:` ref (or plain URL) when the thumbnail was replaced. */
  thumbnailUrl?: string | null;
};

/**
 * Update the editable fields of a video the signed-in user owns.
 *
 * RLS already restricts this to the owner (`auth.uid() = user_id`), so a
 * crafted request can't touch someone else's row — the `.eq("user_id", ...)`
 * below is belt-and-braces so a bad actor gets zero rows instead of an error
 * that leaks whether the video exists.
 */
export async function updateFullVideo(
  id: string,
  userId: string,
  patch: FullVideoEdit,
): Promise<FullVideo> {
  const title = patch.title.trim();
  if (title.length < 3) throw new Error("Give your video a title of at least 3 characters.");
  if (title.length > 100) throw new Error("Titles can be at most 100 characters.");

  const row: Record<string, unknown> = {
    title,
    description: patch.description.trim().slice(0, 5000),
    category: patch.category,
    tags: patch.tags.slice(0, 8),
  };
  if (patch.thumbnailUrl !== undefined) row["thumbnail_url"] = patch.thumbnailUrl;

  const { data, error } = await db
    .from("full_videos")
    .update(row)
    .eq("id", id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (error) throw error;
  return data as FullVideo;
}

/** Remove a video the user owns. Storage objects are left alone (cheap, safe). */
export async function deleteFullVideo(id: string, userId: string): Promise<void> {
  const { error } = await db.from("full_videos").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

/** Upload a replacement thumbnail image and return its `storage:` ref. */
export async function uploadFullVideoThumbnail(blob: Blob, userId: string): Promise<string> {
  const path = `${userId}/full/${Date.now()}-thumb.jpg`;
  const { error } = await supabase.storage
    .from(FULL_VIDEO_BUCKET)
    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
  if (error) throw error;
  return `${STORAGE_PREFIX}${path}`;
}

/* ------------------------------------------------------------------ */
/* Upload                                                              */
/* ------------------------------------------------------------------ */

/** Signed URL for a `storage:` reference; plain URLs pass straight through. */
export async function resolveFullVideoUrl(url: string | null | undefined): Promise<string> {
  if (!url) return "";
  if (!url.startsWith(STORAGE_PREFIX)) return url;
  const { data } = await supabase.storage
    .from(FULL_VIDEO_BUCKET)
    .createSignedUrl(url.slice(STORAGE_PREFIX.length), 60 * 60 * 6);
  return data?.signedUrl ?? "";
}

/** Read duration (seconds) and dimensions from a local file without uploading. */
export function probeVideo(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.onloadedmetadata = () => {
      const result = {
        duration: Math.round(el.duration || 0),
        width: el.videoWidth || 0,
        height: el.videoHeight || 0,
      };
      URL.revokeObjectURL(url);
      resolve(result);
    };
    el.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be read as a video."));
    };
    el.src = url;
  });
}

/** Grab a poster frame from the video so uploads always have a thumbnail. */
export function captureThumbnail(file: File, atSeconds = 1): Promise<Blob | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.preload = "metadata";
    el.muted = true;
    el.playsInline = true;

    const done = (blob: Blob | null) => {
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    el.onloadeddata = () => {
      el.currentTime = Math.min(atSeconds, Math.max(0, (el.duration || 1) - 0.1));
    };
    el.onseeked = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = el.videoWidth || 1280;
        canvas.height = el.videoHeight || 720;
        const ctx = canvas.getContext("2d");
        if (!ctx) return done(null);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => done(blob), "image/jpeg", 0.82);
      } catch {
        done(null);
      }
    };
    el.onerror = () => done(null);
    el.src = url;
  });
}

/**
 * Tus chunk size. Supabase requires a multiple of 6 MB for resumable uploads.
 */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/** base64 for tus `Upload-Metadata` values (btoa can't handle raw UTF-8). */
function b64(value: string): string {
  return btoa(unescape(encodeURIComponent(value)));
}

async function supabaseAccessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("You need to be signed in to upload.");
  return token;
}

/**
 * Upload a file to Supabase Storage as a resumable, chunked upload (tus 1.0.0)
 * and report 0-100 progress as each chunk lands.
 *
 * A single PUT is fine for a 20 MB clip, but a 60-minute video can be several
 * hundred MB — one request that size will time out on a phone. Chunking means
 * a dropped connection only costs the current 6 MB slice, and it gives us a
 * real progress signal to drive the "Uploading 45%..." bar.
 *
 * Falls back to a single signed PUT if the tus endpoint is unavailable, so the
 * feature still works on older storage setups.
 */
export async function uploadWithProgress(
  bucket: string,
  path: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<void> {
  const supabaseUrl = (import.meta.env["VITE_SUPABASE_URL"] || process.env["SUPABASE_URL"] || "").replace(
    /\/+$/,
    "",
  );
  const contentType = file.type || "application/octet-stream";

  if (supabaseUrl) {
    try {
      const token = await supabaseAccessToken();
      const metadata = [
        `bucketName ${b64(bucket)}`,
        `objectName ${b64(path)}`,
        `contentType ${b64(contentType)}`,
        `cacheControl ${b64("3600")}`,
      ].join(",");

      const create = await fetch(`${supabaseUrl}/storage/v1/upload/resumable`, {
        method: "POST",
        headers: {
          "Tus-Resumable": "1.0.0",
          "Upload-Length": String(file.size),
          "Upload-Metadata": metadata,
          "x-upsert": "true",
          Authorization: `Bearer ${token}`,
        },
      });

      if (create.status === 201) {
        const location = create.headers.get("Location");
        if (location) {
          const uploadUrl = location.startsWith("http")
            ? location
            : `${supabaseUrl}/storage/v1${location.startsWith("/") ? "" : "/"}${location}`;

          let offset = 0;
          while (offset < file.size) {
            const chunk = file.slice(offset, Math.min(offset + TUS_CHUNK_SIZE, file.size));
            const patch = await fetch(uploadUrl, {
              method: "PATCH",
              headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Offset": String(offset),
                "Content-Type": "application/offset+octet-stream",
                Authorization: `Bearer ${token}`,
              },
              body: chunk,
            });

            if (patch.status !== 204) {
              throw new Error(`Chunk upload failed (${patch.status}).`);
            }

            offset += chunk.size;
            onProgress(Math.min(99, Math.round((offset / file.size) * 100)));
          }

          onProgress(100);
          return;
        }
      }
    } catch (err) {
      // Auth problems should surface; anything else falls through to the
      // single-request path below so the upload still has a chance.
      if (err instanceof Error && /signed in/i.test(err.message)) throw err;
    }
  }

  // Fallback: one signed PUT, progress via XHR.
  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (signErr || !signed?.signedUrl) {
    throw signErr ?? new Error("Could not start the upload.");
  }

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.signedUrl, true);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "3600");
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        reject(new Error(`Upload failed (${xhr.status}).`));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}

export type CreateFullVideoInput = {
  userId: string;
  username: string;
  title: string;
  description: string;
  category: string;
  tags: string[];
  duration: number;
  videoUrl: string;
  thumbnailUrl: string | null;
};

export async function createFullVideo(input: CreateFullVideoInput): Promise<FullVideo> {
  const { data, error } = await db
    .from("full_videos")
    .insert({
      user_id: input.userId,
      username: input.username,
      title: input.title.trim(),
      description: input.description.trim(),
      category: input.category,
      tags: input.tags,
      duration: Math.min(input.duration, MAX_FULL_VIDEO_SECONDS),
      video_url: input.videoUrl,
      thumbnail_url: input.thumbnailUrl,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as FullVideo;
}

/** Upload the chosen video + thumbnail and return their `storage:` refs. */
export async function uploadFullVideoFiles(
  file: File,
  thumbnail: Blob | null,
  userId: string,
  onProgress: (percent: number) => void,
): Promise<{ videoUrl: string; thumbnailUrl: string | null }> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const videoPath = `${userId}/full/${Date.now()}-${safe}`;

  await uploadWithProgress(FULL_VIDEO_BUCKET, videoPath, file, onProgress);

  let thumbnailUrl: string | null = null;
  if (thumbnail) {
    const thumbPath = `${userId}/full/${Date.now()}-thumb.jpg`;
    const { error } = await supabase.storage
      .from(FULL_VIDEO_BUCKET)
      .upload(thumbPath, thumbnail, { contentType: "image/jpeg", upsert: true });
    if (!error) thumbnailUrl = `${STORAGE_PREFIX}${thumbPath}`;
  }

  return { videoUrl: `${STORAGE_PREFIX}${videoPath}`, thumbnailUrl };
}
