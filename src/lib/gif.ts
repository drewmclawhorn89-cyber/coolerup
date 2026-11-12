/**
 * User-made GIFs — "Make Your Own GIFs", TikTok style.
 *
 * A GIF is cut from a video the user owns, converted in the browser with
 * ffmpeg.wasm (palette-optimised, so it looks like a GIF and not a slideshow),
 * capped at 3 seconds and 5 MB, then stored as a real `.gif` in the public
 * `gifs` bucket with one row in `public.gifs`.
 *
 * Nothing here trusts the client with the limits: the bucket enforces 5 MB and
 * `image/gif`, the table enforces ownership, and `convertVideoToGif` steps the
 * resolution/fps/colour count down until the blob fits.
 */

import { supabase } from "@/integrations/supabase/client";
import { loadFfmpeg, type FfmpegLike } from "@/lib/videoCompression";

export const MAX_GIF_SECONDS = 3;
export const MIN_GIF_SECONDS = 0.5;
export const MAX_GIF_BYTES = 5 * 1024 * 1024;
export const GIF_BUCKET = "gifs";

/** Don't pull a 500 MB video into the wasm heap just to make a 3s GIF. */
export const MAX_GIF_SOURCE_BYTES = 150 * 1024 * 1024;

export type GifRow = {
  id: string;
  user_id: string | null;
  gif_url: string;
  title: string;
  is_public: boolean;
  source_video_id: string | null;
  use_count: number;
  created_at: string;
  /** Joined from profiles when available; not a column on `gifs`. */
  username?: string | null;
};

/** What the picker hands back to a comment / chat composer. */
export type GifPickMeta = {
  id?: string;
  title?: string;
  /** Coolerup handle for user-made GIFs; null for Giphy. */
  username?: string | null;
};

export type GifSpeed = 0.5 | 1 | 2;

export type GifEdit = {
  /** Trim start, in seconds. */
  start: number;
  /** Trim end, in seconds. */
  end: number;
  speed: GifSpeed;
  cropSquare: boolean;
  /** Transparent 1:1 PNG with the text/sticker already drawn. */
  overlay?: Blob | null;
};

export type GifResult = {
  blob: Blob;
  width: number;
  height: number;
  /** Output duration after the speed change, in seconds. */
  duration: number;
};

const GIF_COLS = "id, user_id, gif_url, title, is_public, source_video_id, use_count, created_at";

/** Public URL for an object path inside the `gifs` bucket. */
export function gifPublicUrl(path: string): string {
  return supabase.storage.from(GIF_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Path back out of a public URL, so deleting a row can delete its object. */
function gifObjectPath(url: string): string | null {
  const marker = `/storage/v1/object/public/${GIF_BUCKET}/`;
  const at = url.indexOf(marker);
  if (at < 0) return null;
  return decodeURIComponent(url.slice(at + marker.length).split("?")[0] ?? "");
}

async function attachHandles(rows: GifRow[]): Promise<GifRow[]> {
  const ids = [...new Set(rows.map((r) => r.user_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return rows;
  const { data } = await supabase.from("profiles").select("id, handle").in("id", ids);
  const handles = new Map(
    ((data ?? []) as { id: string; handle: string }[]).map((p) => [p.id, p.handle]),
  );
  return rows.map((r) => ({ ...r, username: r.user_id ? (handles.get(r.user_id) ?? null) : null }));
}

/** Public GIFs, newest first — the "Trending" tab. */
export async function listTrendingGifs(limit = 24): Promise<GifRow[]> {
  const { data, error } = await supabase
    .from("gifs")
    .select(GIF_COLS)
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return attachHandles((data ?? []) as GifRow[]);
}

/** The signed-in user's GIFs, newest first — the "My GIFs" tab. */
export async function listMyGifs(userId: string, limit = 60): Promise<GifRow[]> {
  const { data, error } = await supabase
    .from("gifs")
    .select(GIF_COLS)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return attachHandles((data ?? []) as GifRow[]);
}

/** Title search across public GIFs (used by the picker's search box). */
export async function searchGifs(q: string, limit = 24): Promise<GifRow[]> {
  const term = q.trim();
  if (!term) return listTrendingGifs(limit);
  const { data, error } = await supabase
    .from("gifs")
    .select(GIF_COLS)
    .eq("is_public", true)
    .ilike("title", `%${term.replace(/[%_]/g, "")}%`)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return attachHandles((data ?? []) as GifRow[]);
}

/** Fire-and-forget: feed the "Trending" ordering. */
export function bumpGifUse(id: string): void {
  void supabase.rpc("increment_gif_use", { p_gif_id: id }).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * Upload a finished GIF and create its row. The object path is
 * `{user_id}/{uuid}.gif` so the bucket policy can prove ownership.
 */
export async function createGif({
  userId,
  username,
  blob,
  title,
  isPublic = true,
  sourceVideoId = null,
}: {
  userId: string;
  username: string | null;
  blob: Blob;
  title: string;
  isPublic?: boolean;
  sourceVideoId?: string | null;
}): Promise<GifRow> {
  if (blob.size > MAX_GIF_BYTES) {
    throw new Error("GIF is over 5 MB. Try a shorter clip or a smaller crop.");
  }
  const path = `${userId}/${crypto.randomUUID()}.gif`;
  const { error: upErr } = await supabase.storage.from(GIF_BUCKET).upload(path, blob, {
    contentType: "image/gif",
    cacheControl: "31536000",
    upsert: false,
  });
  if (upErr) throw upErr;

  const url = gifPublicUrl(path);
  const cleanTitle = title.trim().slice(0, 80) || "Untitled GIF";
  const { data, error } = await supabase
    .from("gifs")
    .insert({
      user_id: userId,
      gif_url: url,
      title: cleanTitle,
      is_public: isPublic,
      source_video_id: sourceVideoId,
    })
    .select(GIF_COLS)
    .single();
  if (error) {
    // Don't leave an orphaned object if the row insert is rejected.
    await supabase.storage
      .from(GIF_BUCKET)
      .remove([path])
      .catch(() => undefined);
    throw error;
  }
  return { ...(data as GifRow), username };
}

/** Delete a GIF row and its storage object (owner only, enforced by RLS). */
export async function deleteGif(gif: Pick<GifRow, "id" | "gif_url">): Promise<void> {
  const path = gifObjectPath(gif.gif_url);
  if (path) await supabase.storage.from(GIF_BUCKET).remove([path]);
  const { error } = await supabase.from("gifs").delete().eq("id", gif.id);
  if (error) throw error;
}

/** Flag a GIF that was copied from someone else. */
export async function reportGif(
  gifId: string,
  reporterId: string,
  reason = "stolen",
): Promise<void> {
  const { error } = await supabase
    .from("gif_reports")
    .insert({ gif_id: gifId, reporter_id: reporterId, reason: reason.slice(0, 200) });
  if (error) throw error;
}

/** Fetch a video URL into a File the wasm encoder can read. */
export async function fetchVideoFile(
  url: string,
  onProgress?: (percent: number) => void,
): Promise<File> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Couldn't load that video (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (total > MAX_GIF_SOURCE_BYTES) {
    throw new Error("That video is too large to turn into a GIF. Pick a shorter one.");
  }

  if (!res.body) {
    const blob = await res.blob();
    if (blob.size > MAX_GIF_SOURCE_BYTES) throw new Error("That video is too large for a GIF.");
    return new File([blob], "source.mp4", { type: blob.type || "video/mp4" });
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      if (received > MAX_GIF_SOURCE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("That video is too large to turn into a GIF. Pick a shorter one.");
      }
      if (total > 0) onProgress?.(Math.min(100, Math.round((received / total) * 100)));
    }
  }
  const blob = new Blob(chunks as unknown as BlobPart[], {
    type: res.headers.get("content-type") || "video/mp4",
  });
  return new File([blob], "source.mp4", { type: blob.type || "video/mp4" });
}

function extensionOf(name: string): string {
  const match = /\.[a-z0-9]+$/i.exec(name);
  return match ? match[0].toLowerCase() : ".mp4";
}

type Attempt = { size: number; fps: number; colors: number };

/**
 * Encode attempts, best first. Each step is smaller than the last, so a busy
 * 3s clip that blows past 5 MB still lands as a usable GIF instead of an error.
 */
const ATTEMPTS: Attempt[] = [
  { size: 480, fps: 12, colors: 128 },
  { size: 360, fps: 10, colors: 96 },
  { size: 300, fps: 8, colors: 64 },
];

/**
 * Convert a video clip to an animated GIF.
 *
 * - trim: `-ss`/`-t` before `-i` (fast seek)
 * - speed: `setpts` (0.5× slow, 2× fast) with the source length clamped so the
 *   *output* never exceeds 3 seconds
 * - crop: centre square crop, then scale
 * - text/sticker: a transparent PNG overlay drawn in the editor
 * - palettegen/paletteuse: proper GIF colours, not banded mush
 */
export async function convertVideoToGif(
  file: File,
  edit: GifEdit,
  onProgress?: (percent: number, stage: string) => void,
): Promise<GifResult> {
  if (file.size > MAX_GIF_SOURCE_BYTES) {
    throw new Error("That video is too large to turn into a GIF. Pick a shorter one.");
  }
  const start = Math.max(0, edit.start);
  const requested = Math.max(MIN_GIF_SECONDS, edit.end - start);
  // Slow-motion stretches time, so trim the source further to stay under 3s.
  const sourceDuration = Math.min(requested, MAX_GIF_SECONDS * edit.speed);
  if (sourceDuration < MIN_GIF_SECONDS) {
    throw new Error("Pick at least half a second of video.");
  }

  const inName = `gif_in_${Date.now()}${extensionOf(file.name)}`;
  const overlayName = `gif_overlay_${Date.now()}.png`;
  const outName = `gif_out_${Date.now()}.gif`;

  let ffmpeg: FfmpegLike | null = null;
  let handler: ((e: { progress: number; time: number }) => void) | null = null;

  try {
    onProgress?.(1, "Loading GIF maker");
    ffmpeg = await loadFfmpeg();

    onProgress?.(4, "Reading video");
    await ffmpeg.writeFile(inName, new Uint8Array(await file.arrayBuffer()));
    const hasOverlay = !!edit.overlay && edit.overlay.size > 0;
    if (hasOverlay && edit.overlay) {
      await ffmpeg.writeFile(overlayName, new Uint8Array(await edit.overlay.arrayBuffer()));
    }

    for (let i = 0; i < ATTEMPTS.length; i++) {
      const attempt = ATTEMPTS[i]!;
      const pre = [`setpts=(PTS-STARTPTS)/${edit.speed}`];
      if (edit.cropSquare) pre.push("crop='min(iw,ih)':'min(iw,ih)'");
      pre.push(`scale=${attempt.size}:${attempt.size}:flags=lanczos`);
      pre.push(`fps=${attempt.fps}`);

      const graph = hasOverlay
        ? `[0:v]${pre.join(",")}[base];` +
          `[1:v]scale=${attempt.size}:${attempt.size}:flags=lanczos[ov];` +
          `[base][ov]overlay=0:0:format=auto,split[a][b];` +
          `[a]palettegen=max_colors=${attempt.colors}:stats_mode=diff[p];` +
          `[b][p]paletteuse=dither=bayer:bayer_scale=3`
        : `[0:v]${pre.join(",")},split[a][b];` +
          `[a]palettegen=max_colors=${attempt.colors}:stats_mode=diff[p];` +
          `[b][p]paletteuse=dither=bayer:bayer_scale=3`;

      const args = ["-y", "-ss", String(start), "-t", String(sourceDuration), "-i", inName];
      if (hasOverlay) args.push("-i", overlayName);
      args.push("-filter_complex", graph, "-loop", "0", outName);

      handler = ({ progress, time }) => {
        const ratio = Number.isFinite(progress)
          ? progress
          : time > 0
            ? time / 1_000_000 / sourceDuration
            : 0;
        onProgress?.(
          Math.min(96, Math.max(5, Math.round(Math.max(0, Math.min(1, ratio)) * 90) + 5)),
          i === 0 ? "Making GIF" : "Shrinking GIF",
        );
      };
      ffmpeg.on("progress", handler);

      const code = await ffmpeg.exec(args);
      if (handler) ffmpeg.off("progress", handler);
      handler = null;
      if (code !== 0) {
        await ffmpeg.deleteFile(outName).catch(() => undefined);
        continue;
      }

      const data = await ffmpeg.readFile(outName);
      if (typeof data === "string" || data.byteLength === 0) {
        await ffmpeg.deleteFile(outName).catch(() => undefined);
        continue;
      }
      const blob = new Blob([data as unknown as BlobPart], { type: "image/gif" });
      if (blob.size > MAX_GIF_BYTES) {
        await ffmpeg.deleteFile(outName).catch(() => undefined);
        continue;
      }

      onProgress?.(100, "Done");
      return {
        blob,
        width: attempt.size,
        height: attempt.size,
        duration: sourceDuration / edit.speed,
      };
    }

    throw new Error("Couldn't fit this clip under 5 MB. Try a shorter clip.");
  } catch (err) {
    if (err instanceof Error && /5 MB|too large|half a second/.test(err.message)) throw err;
    throw new Error(
      "GIF conversion failed on this device. Try a shorter clip, or record a new 3s video.",
    );
  } finally {
    try {
      if (ffmpeg && handler) ffmpeg.off("progress", handler);
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => undefined);
        await ffmpeg.deleteFile(outName).catch(() => undefined);
        if (edit.overlay) await ffmpeg.deleteFile(overlayName).catch(() => undefined);
      }
    } catch {
      /* cleanup is best-effort */
    }
  }
}

/** Human-readable size, e.g. "1.4 MB". */
export function formatGifSize(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
