import { resolveVideoUrl, type Video } from "./loop";
import { resolveFullVideoUrl, type FullVideo } from "./fullVideos";
import {
  clearOfflineVideos,
  deleteOfflineVideo,
  getOfflineVideo,
  listOfflineVideos,
  putOfflineVideo,
  type OfflineVideoMeta,
} from "./db";

type Saved = { id: string; video: Video; blob: Blob; size: number; saved_at: number };
export type SavedFullVideo = {
  id: string;
  video: FullVideo;
  blob: Blob;
  size: number;
  saved_at: number;
};

const DB = "loop-offline";
const STORE = "videos";
const FULL_STORE = "full-videos";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE))
        req.result.createObjectStore(STORE, { keyPath: "id" });
      if (!req.result.objectStoreNames.contains(FULL_STORE))
        req.result.createObjectStore(FULL_STORE, { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = fn(db.transaction(store, mode).objectStore(store));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const listeners = new Set<() => void>();
export function onOfflineChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const emit = () => listeners.forEach((f) => f());

export async function getSaved(id: string) {
  return (await tx<Saved | undefined>(STORE, "readonly", (s) => s.get(id))) ?? null;
}

export async function listSaved() {
  const all = await tx<Saved[]>(STORE, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.saved_at - a.saved_at);
}

export async function saveOffline(video: Video, onProgress?: (pct: number) => void) {
  const url = await resolveVideoUrl(video.video_url);
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error("Download failed");
  const total = Number(resp.headers.get("content-length")) || 0;
  const reader = resp.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress?.(Math.round((got / total) * 100));
  }
  const blob = new Blob(chunks, { type: resp.headers.get("content-type") || "video/mp4" });
  await tx(STORE, "readwrite", (s) =>
    s.put({ id: video.id, video, blob, size: blob.size, saved_at: Date.now() }),
  );
  emit();
  return blob.size;
}

/** Download and persist a long-form video in its own IndexedDB store. */
export async function saveFullVideoOffline(video: FullVideo, onProgress?: (pct: number) => void) {
  const url = await resolveFullVideoUrl(video.video_url);
  if (!url) throw new Error("Video is unavailable for download");
  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error("Download failed");
  const total = Number(resp.headers.get("content-length")) || 0;
  const reader = resp.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress?.(Math.round((got / total) * 100));
  }
  const blob = new Blob(chunks, { type: resp.headers.get("content-type") || "video/mp4" });
  await tx(FULL_STORE, "readwrite", (s) =>
    s.put({ id: video.id, video, blob, size: blob.size, saved_at: Date.now() }),
  );
  emit();
  return blob.size;
}

export async function getSavedFullVideo(id: string) {
  return (await tx<SavedFullVideo | undefined>(FULL_STORE, "readonly", (s) => s.get(id))) ?? null;
}

export async function listSavedFullVideos() {
  const all = await tx<SavedFullVideo[]>(FULL_STORE, "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.saved_at - a.saved_at);
}

export async function removeFullVideoOffline(id: string) {
  await tx(FULL_STORE, "readwrite", (s) => s.delete(id));
  emit();
}

export async function removeOffline(id: string) {
  await tx(STORE, "readwrite", (s) => s.delete(id));
  emit();
}

export function formatBytes(n: number) {
  return n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.round(n / 1e3)} KB`;
}

/* ================================================================== */
/* Cache Storage backed offline videos (YouTube-style downloads)      */
/* ================================================================== */

/**
 * The dedicated Cache Storage bucket for downloaded video files. Keeping this
 * separate from the app-shell cache means "Delete all offline storage" can
 * nuke 500 MB of video without touching the shell that boots the app.
 */
export const VIDEO_CACHE = "coolerup-videos";

/** Hard budget for downloaded videos: 500 MB. */
export const MAX_OFFLINE_BYTES = 500 * 1024 * 1024;

/**
 * Cache keys must be absolute http(s) URLs. Supabase `storage:` refs are not,
 * so they are wrapped in a synthetic origin. The ref itself stays stable, which
 * matters because signed URLs expire after a few hours.
 */
const CACHE_ORIGIN = "https://offline.coolerup";

function videoCacheKey(videoUrl: string): string {
  if (/^https?:/i.test(videoUrl)) return videoUrl;
  return `${CACHE_ORIGIN}/video/${encodeURIComponent(videoUrl)}`;
}

export async function openVideoCache(): Promise<Cache> {
  if (typeof caches === "undefined") throw new Error("Cache Storage is not available.");
  return caches.open(VIDEO_CACHE);
}

export type OfflineUsage = { used: number; max: number; count: number };

/** Current bytes used by downloads, the budget, and how many videos. */
export async function getOfflineUsage(): Promise<OfflineUsage> {
  try {
    const rows = await listOfflineVideos();
    const used = rows.reduce((sum, row) => sum + (row.size || 0), 0);
    return { used, max: MAX_OFFLINE_BYTES, count: rows.length };
  } catch {
    return { used: 0, max: MAX_OFFLINE_BYTES, count: 0 };
  }
}

/** Human-readable storage figure for the meter ("200 MB", "1.2 GB"). */
export function formatStorage(n: number): string {
  if (!n || n <= 0) return "0 MB";
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}

/**
 * Download a long-form video into `coolerup-videos` and record its metadata.
 *
 * Progress is reported 0-100 while the body streams. Some signed responses
 * omit `content-length`; in that case `onProgress(0)` is called repeatedly and
 * the UI shows an indeterminate "Downloading…" state instead of a fake bar.
 */
export async function downloadFullVideo(
  video: FullVideo,
  onProgress?: (pct: number) => void,
): Promise<number> {
  const resolved = await resolveFullVideoUrl(video.video_url);
  if (!resolved) throw new Error("Video is unavailable for download.");

  const before = await getOfflineUsage();
  if (before.used >= MAX_OFFLINE_BYTES) {
    throw new Error("Offline storage is full. Delete a download to free space.");
  }

  const resp = await fetch(resolved);
  if (!resp.ok || !resp.body) throw new Error("Download failed. Check your connection.");

  // `content-length` is the real number when CORS exposes it; otherwise fall
  // back to the size the uploader recorded so the bar still moves.
  const total = Number(resp.headers.get("content-length")) || video.expected_bytes || 0;
  if (total && before.used + total > MAX_OFFLINE_BYTES) {
    throw new Error(
      `Not enough offline storage. This video needs ${formatStorage(total)} and only ${formatStorage(
        Math.max(0, MAX_OFFLINE_BYTES - before.used),
      )} is free.`,
    );
  }

  const reader = resp.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;
  onProgress?.(total ? 0 : 0);

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress?.(Math.min(99, Math.round((got / total) * 100)));
  }

  const type = resp.headers.get("content-type") || "video/mp4";
  const blob = new Blob(chunks, { type });

  // Re-check after the fact in case content-length was missing or wrong, and
  // discount the previous copy if this is a re-download.
  const after = await getOfflineUsage();
  const previous = await getOfflineVideo(video.id);
  const replaced = previous?.size ?? 0;
  if (after.used - replaced + blob.size > MAX_OFFLINE_BYTES) {
    throw new Error("Not enough offline storage. Delete a download to free space.");
  }

  const cache = await openVideoCache();
  await cache.put(
    videoCacheKey(video.video_url),
    new Response(blob, {
      headers: { "Content-Type": type, "Content-Length": String(blob.size) },
    }),
  );

  await putOfflineVideo({
    video_id: video.id,
    title: video.title,
    thumbnail: video.thumbnail_url ?? null,
    video_url: video.video_url,
    downloaded_at: Date.now(),
    size: blob.size,
    duration: video.duration ?? 0,
    username: video.username ?? "",
  });

  onProgress?.(100);
  emit();
  return blob.size;
}

/**
 * The cached response for a video, or null when it isn't downloaded.
 *
 * Tries the literal URL first (so a resolved/signed URL or the service worker
 * hits), then the stable cache key derived from the `storage:` ref.
 */
export async function getCachedVideoResponse(videoUrl: string): Promise<Response | null> {
  try {
    const cache = await openVideoCache();
    const direct = await cache.match(videoUrl).catch(() => undefined);
    if (direct) return direct;
    return (await cache.match(videoCacheKey(videoUrl))) ?? null;
  } catch {
    return null;
  }
}

/** A blob: URL for offline playback, or null when nothing is cached. */
export async function getOfflinePlaybackUrl(videoUrl: string): Promise<string | null> {
  const res = await getCachedVideoResponse(videoUrl);
  if (!res) return null;
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export async function isFullVideoDownloaded(videoId: string): Promise<boolean> {
  return (await getOfflineVideo(videoId)) !== null;
}

/** Delete one download: cache bytes + metadata. */
export async function removeDownloadedVideo(videoId: string): Promise<void> {
  const meta = await getOfflineVideo(videoId);
  if (meta) {
    try {
      const cache = await openVideoCache();
      await cache.delete(videoCacheKey(meta.video_url)).catch(() => false);
      await cache.delete(meta.video_url).catch(() => false);
    } catch {
      // A missing cache is fine — the metadata still gets cleaned up.
    }
  }
  await deleteOfflineVideo(videoId);
  emit();
}

/** Free all offline storage: every cached video and every metadata row. */
export async function clearAllDownloads(): Promise<void> {
  try {
    await caches.delete(VIDEO_CACHE);
  } catch {
    // Cache Storage unavailable; still clear metadata below.
  }
  await clearOfflineVideos();
  emit();
}

export type { OfflineVideoMeta };
