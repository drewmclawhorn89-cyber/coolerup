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
  /**
   * `processing` means the row exists but the file is still being uploaded.
   * The uploader plays their own copy from disk; everyone else waits for it to
   * flip to `ready`. `failed` means the upload died and will never finish on
   * its own — the owner can retry or delete it. Older rows predate the column,
   * so it is optional.
   */
  status?: "processing" | "ready" | "failed";
  /** Why the upload failed. Only meaningful when `status` is `failed`. */
  upload_error?: string | null;
  /** Size the finished file should be, used to detect a completed upload. */
  expected_bytes?: number | null;
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

export const STORAGE_PREFIX = "storage:";

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
  /**
   * Who is looking. Rows still in `processing` have no playable object in
   * storage yet, so they are hidden from everyone except their owner — there
   * is nothing worse than clicking a video and getting a dead player.
   */
  viewerId?: string | null;
};

/**
 * PostgREST filter that hides in-flight uploads from strangers while keeping
 * them visible to the person who uploaded them. `status` is nullable because
 * rows created before the column existed are all finished uploads.
 */
function readyOrMine(viewerId?: string | null): string {
  const base = "status.eq.ready,status.is.null";
  if (!viewerId) return base;
  // UUIDs are safe in a PostgREST `or` expression; no commas or parens.
  return `${base},user_id.eq.${viewerId}`;
}
/**
 * True when PostgREST is complaining that `status` doesn't exist, which means
 * the owner hasn't run `instant_publish_sql.sql` yet. In that case every row is
 * a finished upload anyway, so dropping the filter is safe and keeps the page
 * working instead of blowing up.
 */
function missingStatusColumn(error: { message?: string; details?: string } | null): boolean {
  if (!error) return false;
  const text = `${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return text.includes("status") && (text.includes("does not exist") || text.includes("column"));
}

/**
 * Grid query. Category "All" (or empty) means no category filter. Search runs
 * across title, username and description with a single ilike OR clause.
 */
export async function listFullVideos(opts: ListOptions = {}): Promise<FullVideo[]> {
  const { category, search, limit = 60, viewerId } = opts;

  const build = (hideInFlight: boolean) => {
    let query = db
      .from("full_videos")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (hideInFlight) query = query.or(readyOrMine(viewerId));
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
    return query;
  };

  let { data, error } = await build(true);
  if (missingStatusColumn(error)) ({ data, error } = await build(false));

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
  const build = (hideInFlight: boolean) => {
    let query = db
      .from("full_videos")
      .select("*")
      .neq("id", video.id)
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    // Never recommend something that isn't playable yet.
    if (hideInFlight) query = query.or("status.eq.ready,status.is.null");
    return query;
  };

  let { data, error } = await build(true);
  if (missingStatusColumn(error)) ({ data, error } = await build(false));
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
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      fn();
    };
    // Some codecs (HEVC .mov from an iPhone, for one) load without ever firing
    // an event. Without this the picker would hang forever.
    const timer = setTimeout(
      () => finish(() => reject(new Error("That video took too long to read. Try MP4 or WebM."))),
      20_000,
    );
    el.onloadedmetadata = () =>
      finish(() =>
        resolve({
          duration: Math.round(el.duration || 0),
          width: el.videoWidth || 0,
          height: el.videoHeight || 0,
        }),
      );
    el.onerror = () => finish(() => reject(new Error("That file could not be read as a video.")));
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

    let settled = false;
    const done = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(blob);
    };

    // A poster frame is a nicety, never a blocker. If the codec won't decode or
    // seeking stalls, give up after a few seconds and upload without one —
    // otherwise this promise never resolves and the upload never even starts.
    const timer = setTimeout(() => done(null), 8_000);

    el.onloadeddata = () => {
      el.currentTime = Math.min(atSeconds, Math.max(0, (el.duration || 1) - 0.1));
    };
    el.onseeked = () => {
      try {
        // Cap the long edge at 1280px: a 4K frame is ~8 MB of JPEG and buys
        // nothing on a card that renders 300px wide.
        const srcW = el.videoWidth || 1280;
        const srcH = el.videoHeight || 720;
        const scale = Math.min(1, 1280 / Math.max(srcW, srcH));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(srcW * scale));
        canvas.height = Math.max(1, Math.round(srcH * scale));
        const ctx = canvas.getContext("2d");
        if (!ctx) return done(null);
        ctx.drawImage(el, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => done(blob), "image/jpeg", 0.8);
      } catch {
        done(null);
      }
    };
    el.onerror = () => done(null);
    el.src = url;
  });
}

/**
 * Above this size we prefer the resumable path. Below it, one PUT is faster:
 * the browser streams the body over a single HTTP/2 connection instead of
 * paying a round trip per 6 MB chunk.
 *
 * Supabase's own docs recommend resumable uploads past 6 MB; 25 MB is the
 * point where a single request stops being reliably cheaper than chunking.
 */
/**
 * Above this size we prefer the resumable path. Below it, one PUT is faster:
 * the browser streams the body over a single HTTP/2 connection instead of
 * paying a round trip per 6 MB chunk.
 */
const RESUMABLE_THRESHOLD = 25 * 1024 * 1024;

/**
 * Hard ceiling we refuse to even attempt. Supabase's own per-object limit is
 * configurable, but nothing sane exceeds this, and failing in 50 ms beats
 * uploading for twenty minutes and then erroring.
 */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024;

/** Supabase requires resumable chunks to be a multiple of 6 MB. */
const TUS_CHUNK_SIZE = 6 * 1024 * 1024;

/** How long a single chunk may stall before we abort and retry it. */
const CHUNK_STALL_MS = 90_000;

/** Attempts per chunk before the whole upload is declared dead. */
const CHUNK_ATTEMPTS = 5;

export type UploadProgress = {
  /** Bytes confirmed on the server. */
  loaded: number;
  total: number;
  /** Smoothed throughput, bytes/second. */
  bytesPerSecond: number;
  /** Seconds remaining, or null while the estimate is still settling. */
  etaSeconds: number | null;
};

export type ProgressHandler = (percent: number, info?: UploadProgress) => void;

/** An upload failure that carries the HTTP status, so callers can react to it. */
class UploadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

/** Turn a 413 into something a human can act on. */
function tooLargeMessage(file: File): string {
  const mb = (file.size / (1024 * 1024)).toFixed(1);
  return (
    `This video is ${mb} MB, which is over your Supabase project's storage limit. ` +
    `Raise it in Supabase → Storage → Settings (Global file size limit) and set the ` +
    `"videos" bucket's own limit, or upload a smaller file.`
  );
}

/** Exponential backoff that also honours a Retry-After header when present. */
function backoffMs(attempt: number, retryAfterSeconds?: number | null): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 30_000);
  }
  return Math.min(1000 * 2 ** attempt, 15_000);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Tracks throughput and ETA so a long upload can show "3.2 MB/s · 4 min left"
 * instead of a bar that appears frozen.
 */
class Speedometer {
  private samples: { at: number; loaded: number }[] = [];
  private lastEmit = 0;

  constructor(private total: number) {}

  /** Returns the info object, or null if it is too soon to report again. */
  sample(loaded: number): UploadProgress | null {
    const now = Date.now();
    this.samples.push({ at: now, loaded });
    // Keep a 15s window so the estimate reacts to a connection that changes.
    while (this.samples.length > 2 && now - this.samples[0]!.at > 15_000) this.samples.shift();

    if (now - this.lastEmit < 400) return null;
    this.lastEmit = now;

    const first = this.samples[0]!;
    const elapsed = (now - first.at) / 1000;
    const moved = loaded - first.loaded;
    const bytesPerSecond = elapsed > 0.5 && moved > 0 ? moved / elapsed : 0;
    const remaining = this.total - loaded;
    return {
      loaded,
      total: this.total,
      bytesPerSecond,
      etaSeconds: bytesPerSecond > 0 ? Math.round(remaining / bytesPerSecond) : null,
    };
  }
}

/**
 * Upload a file to Supabase Storage and report 0-100 progress.
 *
 * Small files go up as a **single signed PUT** — one request, one round trip.
 * Anything larger uses tus resumable chunks, which is also the fallback when a
 * PUT is rejected.
 *
 * Every network operation retries with backoff and a stall timeout. That is the
 * difference between "a 15-minute video finishes" and "a 15-minute video dies
 * at 60% because one of its 150 chunks hit a hiccup".
 */
export async function uploadWithProgress(
  bucket: string,
  path: string,
  file: File,
  onProgress: ProgressHandler,
  opts: { preferResumable?: boolean } = {},
): Promise<void> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(
      `That file is ${(file.size / (1024 * 1024 * 1024)).toFixed(1)} GB. The limit is 5 GB.`,
    );
  }

  const contentType = file.type || "application/octet-stream";
  const resumable = opts.preferResumable === true || file.size > RESUMABLE_THRESHOLD;

  if (!resumable) {
    try {
      await singlePut(bucket, path, file, contentType, onProgress);
      return;
    } catch (err) {
      // A hard auth failure is worth surfacing; anything else (flaky network,
      // timeout, size rejection) is exactly what the resumable path is for.
      if (err instanceof Error && /signed in/i.test(err.message)) throw err;
      onProgress(0);
    }
  }

  try {
    await resumableUpload(bucket, path, file, contentType, onProgress);
  } catch (err) {
    if (err instanceof UploadError && err.status === 413) throw new Error(tooLargeMessage(file));
    throw err;
  }
}

/** One signed PUT, progress from XHR's upload events, retried once on failure. */
async function singlePut(
  bucket: string,
  path: string,
  file: File,
  contentType: string,
  onProgress: ProgressHandler,
): Promise<void> {
  const { data: signed, error: signErr } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(path);
  if (signErr || !signed?.signedUrl) {
    throw signErr ?? new Error("Could not start the upload.");
  }

  const speedo = new Speedometer(file.size);

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", signed.signedUrl, true);
    xhr.setRequestHeader("x-upsert", "true");
    xhr.setRequestHeader("cache-control", "3600");
    xhr.setRequestHeader("content-type", contentType);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const info = speedo.sample(e.loaded);
      onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)), info ?? undefined);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(100);
        resolve();
      } else {
        // Supabase puts a readable reason in the body ("The object exceeded the
        // maximum allowed size"); keep it rather than a bare status code.
        let detail = "";
        try {
          const parsed = JSON.parse(xhr.responseText) as { message?: string; error?: string };
          detail = parsed.message ?? parsed.error ?? "";
        } catch {
          detail = xhr.responseText.slice(0, 200);
        }
        reject(
          new UploadError(
            detail ? `Upload failed (${xhr.status}): ${detail}` : `Upload failed (${xhr.status}).`,
            xhr.status,
          ),
        );
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed. Check your connection."));
    xhr.onabort = () => reject(new Error("Upload cancelled."));
    xhr.send(file);
  });
}

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
 * Where an in-flight upload is parked so it can be resumed.
 *
 * Keyed by the reserved object path, which is unique per upload. A 15-minute
 * video can outlive a page refresh; without this, closing the tab at 80% means
 * starting from zero.
 */
type ResumeState = { url: string; offset: number };

function resumeKey(bucket: string, path: string): string {
  return `coolerup:upload:${bucket}:${path}`;
}

function readResume(bucket: string, path: string): ResumeState | null {
  try {
    const raw = sessionStorage.getItem(resumeKey(bucket, path));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ResumeState;
    return typeof parsed.url === "string" && typeof parsed.offset === "number" ? parsed : null;
  } catch {
    return null;
  }
}

function writeResume(bucket: string, path: string, state: ResumeState): void {
  try {
    sessionStorage.setItem(resumeKey(bucket, path), JSON.stringify(state));
  } catch {
    // Private mode / quota — resuming is a nicety, not a requirement.
  }
}

function clearResume(bucket: string, path: string): void {
  try {
    sessionStorage.removeItem(resumeKey(bucket, path));
  } catch {
    /* ignore */
  }
}

/** Ask the server how many bytes it already has for this upload URL. */
async function serverOffset(url: string, token: string): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { "Tus-Resumable": "1.0.0", Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const raw = res.headers.get("Upload-Offset");
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Resumable tus 1.0.0 upload — the path every real video takes. */
async function resumableUpload(
  bucket: string,
  path: string,
  file: File,
  contentType: string,
  onProgress: ProgressHandler,
): Promise<void> {
  const supabaseUrl = (
    import.meta.env["VITE_SUPABASE_URL"] ||
    process.env["SUPABASE_URL"] ||
    ""
  ).replace(/\/+$/, "");

  if (!supabaseUrl) throw new Error("Storage is not configured.");

  const token = await supabaseAccessToken();
  const speedo = new Speedometer(file.size);

  /* ---- 1. Resume an upload that was interrupted, or create a new one ---- */

  let uploadUrl: string | null = null;
  let offset = 0;

  const parked = readResume(bucket, path);
  if (parked) {
    const confirmed = await serverOffset(parked.url, token);
    if (confirmed !== null && confirmed <= file.size) {
      uploadUrl = parked.url;
      offset = confirmed;
      if (offset > 0) {
        const info = speedo.sample(offset);
        onProgress(Math.min(99, Math.round((offset / file.size) * 100)), info ?? undefined);
      }
    } else {
      clearResume(bucket, path);
    }
  }

  if (!uploadUrl) {
    const metadata = [
      `bucketName ${b64(bucket)}`,
      `objectName ${b64(path)}`,
      `contentType ${b64(contentType)}`,
      `cacheControl ${b64("3600")}`,
    ].join(",");

    let create: Response | null = null;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt += 1) {
      try {
        create = await fetch(`${supabaseUrl}/storage/v1/upload/resumable`, {
          method: "POST",
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Length": String(file.size),
            "Upload-Metadata": metadata,
            "x-upsert": "true",
            Authorization: `Bearer ${token}`,
          },
        });
        if (create.status === 201) break;
        if (create.status === 413) throw new UploadError("Payload too large", 413);
        if (create.status < 500 && create.status !== 429) break;
      } catch (err) {
        if (err instanceof UploadError) throw err;
        lastErr = err;
      }
      await sleep(backoffMs(attempt));
    }

    if (!create) throw lastErr instanceof Error ? lastErr : new Error("Could not start the upload.");
    if (create.status !== 201) {
      throw new UploadError(`Could not start the upload (${create.status}).`, create.status);
    }

    const location = create.headers.get("Location");
    if (!location) throw new Error("Could not start the upload.");

    uploadUrl = location.startsWith("http")
      ? location
      : `${supabaseUrl}/storage/v1${location.startsWith("/") ? "" : "/"}${location}`;
    offset = 0;
    writeResume(bucket, path, { url: uploadUrl, offset });
  }

  /* ---- 2. Push the remaining bytes, retrying each chunk in place ---- */

  while (offset < file.size) {
    const end = Math.min(offset + TUS_CHUNK_SIZE, file.size);
    const chunk = file.slice(offset, end);

    let ok = false;
    let lastErr: unknown = null;

    for (let attempt = 0; attempt < CHUNK_ATTEMPTS && !ok; attempt += 1) {
      const controller = new AbortController();
      // A stalled chunk is worse than a failed one: abort so it can be retried
      // rather than sitting at 62% forever.
      const watchdog = setTimeout(() => controller.abort(), CHUNK_STALL_MS);
      try {
        const patch = await fetch(uploadUrl, {
          method: "PATCH",
          headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream",
            Authorization: `Bearer ${token}`,
          },
          body: chunk,
          signal: controller.signal,
        });

        if (patch.status === 204) {
          ok = true;
          break;
        }
        if (patch.status === 413) throw new UploadError("Payload too large", 413);
        if (patch.status === 409) {
          // Offset drifted (a previous attempt actually landed). Re-sync.
          const confirmed = await serverOffset(uploadUrl, token);
          if (confirmed !== null) {
            offset = confirmed;
            writeResume(bucket, path, { url: uploadUrl, offset });
            ok = true;
            break;
          }
        }
        lastErr = new UploadError(`Chunk upload failed (${patch.status}).`, patch.status);
        // 4xx other than 408/429 will not get better by retrying.
        if (patch.status >= 400 && patch.status < 500 && patch.status !== 408 && patch.status !== 429) {
          throw lastErr;
        }
      } catch (err) {
        if (err instanceof UploadError && err.status === 413) throw err;
        lastErr = err;
      } finally {
        clearTimeout(watchdog);
      }

      if (!ok) await sleep(backoffMs(attempt));
    }

    if (!ok) {
      throw lastErr instanceof Error
        ? lastErr
        : new Error("The upload kept failing. Check your connection and try again.");
    }

    if (offset < end) offset = end;
    writeResume(bucket, path, { url: uploadUrl, offset });
    const info = speedo.sample(offset);
    onProgress(Math.min(99, Math.round((offset / file.size) * 100)), info ?? undefined);
  }

  clearResume(bucket, path);
  onProgress(100);
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
  /** Defaults to `ready`; pass `processing` when the bytes are still moving. */
  status?: "processing" | "ready" | "failed";
  /** Size of the file being uploaded, so a finished upload can be detected. */
  expectedBytes?: number | null;
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
      status: input.status ?? "ready",
      expected_bytes: input.expectedBytes ?? null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as FullVideo;
}

/**
 * Mark a video as finished once its bytes have landed.
 *
 * Publishing inserts the row first (so it shows up instantly) and calls this
 * when the upload completes, which is what flips `processing` to `ready` and
 * points `video_url` at the real object.
 */
export async function finalizeFullVideo(
  id: string,
  patch: { videoUrl: string; thumbnailUrl: string | null },
): Promise<void> {
  const { error } = await db
    .from("full_videos")
    .update({
      video_url: patch.videoUrl,
      thumbnail_url: patch.thumbnailUrl,
      status: "ready",
    })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Record that an upload will never finish on its own.
 *
 * Without this the row sat on `processing` forever: invisible to everyone
 * else, unplayable for the owner, and with no way to retry or remove it. Now
 * it becomes `failed` with a reason the owner can act on.
 */
export async function markFullVideoFailed(id: string, reason: string): Promise<void> {
  const { error } = await db
    .from("full_videos")
    .update({ status: "failed", upload_error: reason.slice(0, 500) })
    .eq("id", id);
  if (error) throw error;
}

/** Put a failed video back into `processing` before a retry upload starts. */
export async function reopenFullVideo(id: string): Promise<void> {
  const { error } = await db
    .from("full_videos")
    .update({ status: "processing", upload_error: null })
    .eq("id", id);
  if (error) throw error;
}

/**
 * How many bytes of an object are actually in storage, or `null` if there is
 * no such object yet.
 *
 * Supabase's tus endpoint creates the object when the upload starts, so a
 * partially-uploaded file shows up here with a size smaller than the source.
 * Comparing that against `expected_bytes` is what lets the app tell "still
 * moving" apart from "finished, but the row never got updated".
 */
export async function storageObjectSize(path: string): Promise<number | null> {
  const slash = path.lastIndexOf("/");
  const dir = slash === -1 ? "" : path.slice(0, slash);
  const name = slash === -1 ? path : path.slice(slash + 1);

  const { data, error } = await supabase.storage
    .from(FULL_VIDEO_BUCKET)
    .list(dir, { search: name, limit: 100 });
  if (error) return null;

  const hit = (data ?? []).find((entry) => entry.name === name);
  if (!hit) return null;

  // Supabase exposes the size under `metadata.size` on the storage API.
  const size = (hit as { metadata?: { size?: number } }).metadata?.size;
  return typeof size === "number" ? size : null;
}

/**
 * Where an upload will live in storage.
 *
 * Computed *before* the upload starts so the row can be inserted — and the
 * video shown — while the bytes are still in flight.
 */
export function fullVideoObjectPath(userId: string, fileName: string): string {
  const safe = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${userId}/full/${Date.now()}-${safe}`;
}

/**
 * Upload the chosen video and thumbnail and return their `storage:` refs.
 *
 * The thumbnail is a few hundred KB and the video can be hundreds of MB, so
 * they go up **at the same time** — waiting for the video before starting a
 * 200 KB image wasted a whole round trip on every publish.
 */
export async function uploadFullVideoFiles(
  file: File,
  thumbnail: Blob | null,
  userId: string,
  onProgress: ProgressHandler,
  opts: { videoPath?: string } = {},
): Promise<{ videoUrl: string; thumbnailUrl: string | null }> {
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamp = Date.now();
  // The caller may have reserved a path before inserting the row, so the row
  // and the upload agree on where the file will end up.
  const videoPath = opts.videoPath ?? `${userId}/full/${stamp}-${safe}`;

  const thumbPromise: Promise<string | null> = thumbnail
    ? supabase.storage
        .from(FULL_VIDEO_BUCKET)
        .upload(`${userId}/full/${stamp}-thumb.jpg`, thumbnail, {
          contentType: "image/jpeg",
          upsert: true,
        })
        .then(({ error }) =>
          error ? null : `${STORAGE_PREFIX}${userId}/full/${stamp}-thumb.jpg`,
        )
        .catch(() => null)
    : Promise.resolve(null);

  const [, thumbnailUrl] = await Promise.all([
    uploadWithProgress(FULL_VIDEO_BUCKET, videoPath, file, onProgress),
    thumbPromise,
  ]);

  return { videoUrl: `${STORAGE_PREFIX}${videoPath}`, thumbnailUrl };
}
