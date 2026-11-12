import { soundAudioUrl, isYouTubeSound, type Sound } from "./sounds";

/**
 * Offline songs for the Music tab.
 *
 * Same idea as `offline.ts` (which stores videos), but a separate object store
 * so a song download never collides with a video download. The audio file is
 * fetched ONCE from `audio_url` and kept as a Blob in IndexedDB — after that the
 * song plays with zero signal, because we hand the `<audio>` element a local
 * `blob:` URL instead of hitting Supabase again.
 *
 * Copyright rule: only Coolerup-owned audio (a user's own sound / royalty-free
 * library track) can be stored. YouTube songs are streamed from YouTube's own
 * player and are never downloaded — that keeps the app from getting banned.
 */

export type SavedSong = {
  id: string;
  /** Snapshot of the row, so the Downloaded tab works with no network at all. */
  sound: Sound;
  blob: Blob;
  size: number;
  saved_at: number;
  /** Used by the 30-day "delete to save space?" prompt. */
  last_played_at: number;
};

const DB = "loop-offline";
const VERSION = 3;
const STORE = "songs";

/** Songs untouched for this long get offered up for deletion. */
export const STALE_DAYS = 30;

function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      // The video stores are created here too so either module can be the one
      // that performs the upgrade.
      if (!db.objectStoreNames.contains("videos"))
        db.createObjectStore("videos", { keyPath: "id" });
      if (!db.objectStoreNames.contains("full-videos"))
        db.createObjectStore("full-videos", { keyPath: "id" });
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function tx<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

const listeners = new Set<() => void>();
export function onOfflineSongsChange(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}
const emit = () => listeners.forEach((f) => f());

/* -------------------------------------------------------------------------- */
/* Copyright policy                                                            */
/* -------------------------------------------------------------------------- */

export type DownloadBlockReason = "copyright" | "unavailable";

/**
 * Can this song be stored on the device?
 *
 * YouTube songs stream from YouTube's player — downloading them would mean
 * re-hosting someone else's copyrighted audio, so they are stream-only.
 */
export function downloadBlockedReason(sound: Sound | null | undefined): DownloadBlockReason | null {
  if (!sound) return "unavailable";
  if (isYouTubeSound(sound)) return "copyright";
  if (!sound.audio_url) return "unavailable";
  return null;
}

export function canDownloadSong(sound: Sound | null | undefined): boolean {
  return downloadBlockedReason(sound) === null;
}

/** Message shown when a download is refused. */
export function downloadBlockedMessage(reason: DownloadBlockReason): string {
  return reason === "copyright"
    ? "YouTube songs stream only. Add your own audio file to play this one offline."
    : "Can't download — this song has no audio file.";
}

/* -------------------------------------------------------------------------- */
/* Local playback URLs                                                         */
/* -------------------------------------------------------------------------- */

/** One object URL per downloaded song, reused so we never leak blobs. */
const urlCache = new Map<string, string>();

function urlFor(id: string, blob: Blob): string {
  const existing = urlCache.get(id);
  if (existing) return existing;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

function forgetUrl(id: string) {
  const existing = urlCache.get(id);
  if (existing) {
    URL.revokeObjectURL(existing);
    urlCache.delete(id);
  }
}

/* -------------------------------------------------------------------------- */
/* Reads                                                                       */
/* -------------------------------------------------------------------------- */

export async function getSavedSong(id: string): Promise<SavedSong | null> {
  if (!id) return null;
  return (await tx<SavedSong | undefined>("readonly", (s) => s.get(id))) ?? null;
}

export async function listSavedSongs(): Promise<SavedSong[]> {
  const all = await tx<SavedSong[]>("readonly", (s) => s.getAll());
  return all.sort((a, b) => b.saved_at - a.saved_at);
}

export async function listSavedSongIds(): Promise<Set<string>> {
  const all = await listSavedSongs();
  return new Set(all.map((s) => s.id));
}

/** Total bytes used by downloaded songs. */
export async function offlineSongsSize(): Promise<number> {
  const all = await listSavedSongs();
  return all.reduce((sum, s) => sum + (s.size || 0), 0);
}

/**
 * Playable URL for a downloaded song, or "" when it isn't downloaded.
 *
 * This is what makes 0-signal playback work: `openSong` asks for this first and
 * only falls back to a network URL when there's no local copy.
 */
export async function offlineSongUrl(id: string): Promise<string> {
  const saved = await getSavedSong(id);
  if (!saved) return "";
  return urlFor(saved.id, saved.blob);
}

/** Downloaded songs not played in `STALE_DAYS` days. */
export async function listStaleSongs(days = STALE_DAYS): Promise<SavedSong[]> {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const all = await listSavedSongs();
  return all.filter((s) => (s.last_played_at || s.saved_at) < cutoff);
}

/* -------------------------------------------------------------------------- */
/* Writes                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Download a song's audio into IndexedDB, reporting 0-100 progress.
 *
 * Returns the stored size in bytes. Throws when the song can't be downloaded
 * (copyright / no file) so the caller can show the right message.
 */
export async function saveSongOffline(
  sound: Sound,
  onProgress?: (pct: number) => void,
): Promise<number> {
  const blocked = downloadBlockedReason(sound);
  if (blocked) throw new Error(downloadBlockedMessage(blocked));

  const url = await soundAudioUrl(sound);
  if (!url) throw new Error("Can't download — this song has no audio file.");

  const resp = await fetch(url);
  if (!resp.ok || !resp.body) throw new Error("Download failed. Check your connection.");

  const total = Number(resp.headers.get("content-length")) || 0;
  const reader = resp.body.getReader();
  const chunks: BlobPart[] = [];
  let got = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (total) onProgress?.(Math.min(99, Math.round((got / total) * 100)));
  }

  const blob = new Blob(chunks, { type: resp.headers.get("content-type") || "audio/mpeg" });
  const now = Date.now();
  const record: SavedSong = {
    id: sound.id,
    sound,
    blob,
    size: blob.size,
    saved_at: now,
    last_played_at: now,
  };

  await tx("readwrite", (s) => s.put(record));
  forgetUrl(sound.id);
  onProgress?.(100);
  emit();
  return blob.size;
}

/**
 * Store an audio file the user picked from their phone.
 *
 * This is how a YouTube song becomes playable offline: we never fetch anything
 * from YouTube, the user supplies a file they already have, and it is kept in
 * IndexedDB exactly like an own-sound download.
 */
export async function saveSongFileOffline(
  sound: Sound,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<number> {
  const looksAudio =
    (file.type && file.type.startsWith("audio/")) ||
    /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|mp4)$/i.test(file.name);
  if (!looksAudio) throw new Error("Pick an audio file (MP3, M4A, WAV…).");

  const total = file.size || 0;
  let blob: Blob;

  if (typeof file.stream === "function") {
    const reader = file.stream().getReader();
    const chunks: BlobPart[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      got += value.length;
      if (total) onProgress?.(Math.min(99, Math.round((got / total) * 100)));
    }
    blob = new Blob(chunks, { type: file.type || "audio/mpeg" });
  } else {
    blob = file;
  }

  const now = Date.now();
  const record: SavedSong = {
    id: sound.id,
    sound,
    blob,
    size: blob.size,
    saved_at: now,
    last_played_at: now,
  };

  await tx("readwrite", (s) => s.put(record));
  forgetUrl(sound.id);
  onProgress?.(100);
  emit();
  return blob.size;
}

/** Mark a downloaded song as played just now (resets the 30-day clock). */
export async function markSongPlayed(id: string): Promise<void> {
  const saved = await getSavedSong(id);
  if (!saved) return;
  await tx("readwrite", (s) => s.put({ ...saved, last_played_at: Date.now() }));
  emit();
}

export async function removeSongOffline(id: string): Promise<void> {
  await tx("readwrite", (s) => s.delete(id));
  forgetUrl(id);
  emit();
}

/** Used by the "delete to save space?" prompt. */
export async function removeStaleSongs(days = STALE_DAYS): Promise<number> {
  const stale = await listStaleSongs(days);
  for (const s of stale) await removeSongOffline(s.id);
  return stale.length;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

export function formatStorage(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
