import { resolveVideoUrl, type Video } from "./loop";
import { resolveFullVideoUrl, type FullVideo } from "./fullVideos";

type Saved = { id: string; video: Video; blob: Blob; size: number; saved_at: number };
export type SavedFullVideo = { id: string; video: FullVideo; blob: Blob; size: number; saved_at: number };

const DB = "loop-offline";
const STORE = "videos";
const FULL_STORE = "full-videos";

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: "id" });
      if (!req.result.objectStoreNames.contains(FULL_STORE)) req.result.createObjectStore(FULL_STORE, { keyPath: "id" });
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
  await tx(STORE, "readwrite", (s) => s.put({ id: video.id, video, blob, size: blob.size, saved_at: Date.now() }));
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
