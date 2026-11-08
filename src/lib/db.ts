/**
 * Tiny IndexedDB wrapper for offline video metadata.
 *
 * The video *bytes* live in the Cache Storage API (`coolerup-videos`, see
 * lib/offline.ts). This database only keeps the small, structured record that
 * lets the app render the Offline page without touching the network:
 *
 *   offline_videos: video_id, title, thumbnail, video_url, downloaded_at
 *
 * Keeping metadata separate from bytes is deliberate: reading a 40-row list
 * out of IndexedDB is instant, whereas scanning a 500 MB cache to work out
 * what has been downloaded is not.
 */

const DB_NAME = "coolerup-offline";
const DB_VERSION = 1;
const STORE = "offline_videos";

/** One downloaded long-form video. */
export type OfflineVideoMeta = {
  /** Primary key — the `full_videos.id` this record describes. */
  video_id: string;
  title: string;
  /** Thumbnail URL (may be a `storage:` ref or a plain https URL). */
  thumbnail: string | null;
  /**
   * Stable reference to the video file. This is the key used in the
   * `coolerup-videos` cache, so it must not be an expiring signed URL.
   */
  video_url: string;
  /** Epoch millis when the download finished. */
  downloaded_at: number;
  /** Bytes stored, used for the "Offline storage: X / 500MB" meter. */
  size: number;
  /** Seconds, so the offline card can still show a duration. */
  duration: number;
  /** Channel handle, shown under the title offline. */
  username: string;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "video_id" });
        // Newest downloads first is the default ordering for the Offline page.
        store.createIndex("downloaded_at", "downloaded_at");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open offline database."));
  });

  return dbPromise;
}

function request<T>(store: IDBObjectStore, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Offline database request failed."));
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return request(db.transaction(STORE, mode).objectStore(STORE), fn);
}

/** Insert or replace one downloaded-video record. */
export async function putOfflineVideo(meta: OfflineVideoMeta): Promise<void> {
  await withStore("readwrite", (s) => s.put(meta));
}

/** One record, or null when the video isn't downloaded. */
export async function getOfflineVideo(videoId: string): Promise<OfflineVideoMeta | null> {
  const row = await withStore<OfflineVideoMeta | undefined>("readonly", (s) => s.get(videoId));
  return row ?? null;
}

/** Every downloaded video, newest first. */
export async function listOfflineVideos(): Promise<OfflineVideoMeta[]> {
  const rows = await withStore<OfflineVideoMeta[]>("readonly", (s) => s.getAll());
  return rows.sort((a, b) => b.downloaded_at - a.downloaded_at);
}

/** Remove one metadata record. Bytes are removed by lib/offline.ts. */
export async function deleteOfflineVideo(videoId: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(videoId));
}

/** Wipe every metadata record (used by "Delete all offline storage"). */
export async function clearOfflineVideos(): Promise<void> {
  await withStore("readwrite", (s) => s.clear());
}

/** True when this video has a metadata record (i.e. is downloaded). */
export async function isOfflineVideo(videoId: string): Promise<boolean> {
  return (await getOfflineVideo(videoId)) !== null;
}
