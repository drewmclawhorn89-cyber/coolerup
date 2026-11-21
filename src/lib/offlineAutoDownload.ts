import { supabase } from "@/integrations/supabase/client";
import { fetchLikedVideos, fetchSavedVideos, type Video } from "@/lib/loop";
import { listFullVideosByIds, type FullVideo } from "@/lib/fullVideos";
import {
  MAX_OFFLINE_VIDEOS,
  OfflineLimitError,
  getOfflineUsage,
  listSaved,
  listSavedFullVideos,
  saveFullVideoOffline,
  saveOffline,
} from "@/lib/offline";
import { isOfflineModeOn } from "@/lib/offlineMode";
import { planUnlocksOffline } from "@/lib/subscriptions";
import { untypedDb } from "@/lib/untypedDb";

export { OFFLINE_SYNC_EVENT, requestOfflineSync } from "@/lib/offlineEvents";

const db = untypedDb;

export type OfflineSyncResult = {
  downloaded: number;
  /** Videos already offline, unavailable, or over the cap. */
  skipped: number;
  /** Videos the sync considered. */
  total: number;
  /** True when the 50-video cap stopped the run. */
  capped: boolean;
};

export type OfflineSyncProgress = {
  /** 1-based index of the video being downloaded. */
  current: number;
  total: number;
  title: string;
};

async function likedAndSavedFullVideoIds(userId: string): Promise<string[]> {
  const ids = new Set<string>();

  try {
    const { data } = await db.from("saved_full_videos").select("video_id").eq("user_id", userId);
    for (const row of (data ?? []) as { video_id?: string }[]) {
      if (row.video_id) ids.add(String(row.video_id));
    }
  } catch {
    // Table not migrated yet; likes still work.
  }

  try {
    const { data } = await db
      .from("full_video_likes")
      .select("video_id")
      .eq("user_id", userId)
      .eq("reaction", "like");
    for (const row of (data ?? []) as { video_id?: string }[]) {
      if (row.video_id) ids.add(String(row.video_id));
    }
  } catch {
    // Ignore a missing likes table.
  }

  return [...ids];
}

function isDownloadableFull(video: FullVideo): boolean {
  if (video.is_youtube) return false;
  if (video.status === "processing" || video.status === "failed") return false;
  return Boolean(video.video_url);
}

function isDownloadableShort(video: Video): boolean {
  return Boolean(video.video_url);
}

/**
 * Bring the offline library up to date with the user's likes and saves.
 *
 * Only runs for a paid, active plan with Offline Mode switched ON. It never
 * deletes anything: videos that no longer fit, are YouTube-only, or are still
 * uploading are skipped. Downloads stop at `MAX_OFFLINE_VIDEOS`.
 */
export async function syncOfflineLibrary(
  handle: string | null | undefined,
  userId: string | null | undefined,
  onProgress?: (progress: OfflineSyncProgress) => void,
): Promise<OfflineSyncResult> {
  const empty: OfflineSyncResult = { downloaded: 0, skipped: 0, total: 0, capped: false };
  if (!userId || !handle) return empty;
  if (!planUnlocksOffline(handle)) return empty;
  if (!isOfflineModeOn()) return empty;
  if (typeof navigator !== "undefined" && !navigator.onLine) return empty;

  const [usage, savedFull, savedShorts] = await Promise.all([
    getOfflineUsage(),
    listSavedFullVideos(),
    listSaved(),
  ]);

  const offlineIds = new Set<string>([
    ...savedFull.map((row) => row.id),
    ...savedShorts.map((row) => row.id),
  ]);

  let count = usage.count;
  if (count >= MAX_OFFLINE_VIDEOS) return { ...empty, capped: true };

  // Full-length videos first: these are what the Videos > Offline tab shows.
  const fullIds = await likedAndSavedFullVideoIds(userId);
  const fullVideos = (await listFullVideosByIds(fullIds))
    .filter(isDownloadableFull)
    .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));

  // Then vertical feed videos the user liked or saved.
  let shorts: Video[] = [];
  try {
    const [liked, saved] = await Promise.all([
      fetchLikedVideos(userId, MAX_OFFLINE_VIDEOS),
      fetchSavedVideos(userId, MAX_OFFLINE_VIDEOS),
    ]);
    const seen = new Set<string>();
    shorts = [...saved, ...liked].filter((video) => {
      if (!isDownloadableShort(video) || seen.has(video.id)) return false;
      seen.add(video.id);
      return true;
    });
  } catch {
    shorts = [];
  }

  const queue: Array<{ id: string; title: string; run: () => Promise<unknown> }> = [];
  for (const video of fullVideos) {
    if (offlineIds.has(video.id)) continue;
    queue.push({
      id: video.id,
      title: video.title || "video",
      run: () => saveFullVideoOffline(video),
    });
  }
  for (const video of shorts) {
    if (offlineIds.has(video.id)) continue;
    queue.push({
      id: video.id,
      title: video.caption || `@${video.username}`,
      run: () => saveOffline(video),
    });
  }

  const total = queue.length;
  let downloaded = 0;
  let skipped = 0;
  let capped = false;

  for (let i = 0; i < queue.length; i++) {
    if (count >= MAX_OFFLINE_VIDEOS) {
      capped = true;
      skipped += queue.length - i;
      break;
    }
    const item = queue[i]!;
    onProgress?.({ current: i + 1, total, title: item.title });
    try {
      await item.run();
      downloaded += 1;
      count += 1;
      offlineIds.add(item.id);
    } catch (error) {
      if (error instanceof OfflineLimitError) {
        capped = true;
        skipped += queue.length - i;
        break;
      }
      // A single dead link must not stop the rest of the library.
      skipped += 1;
    }
  }

  return { downloaded, skipped, total, capped };
}
