/**
 * Lightweight feed metadata cache.
 *
 * On a slow connection the first paint used to be an empty "Loading your feed…"
 * screen while a 20-row request travelled over the network. We now keep the last
 * feed page in localStorage so returning users see content immediately, then
 * refresh in the background. Only metadata is cached — video bytes are handled
 * by the offline IndexedDB store.
 */
import type { Video } from "./loop";

const KEY = "feed-cache:v1";
const DEFAULT_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hours
const MAX_ITEMS = 60;

type CacheShape = { at: number; videos: Video[] };

export function readFeedCache(maxAge = DEFAULT_MAX_AGE): Video[] | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed || !Array.isArray(parsed.videos) || parsed.videos.length === 0) return null;
    if (typeof parsed.at !== "number" || Date.now() - parsed.at > maxAge) return null;
    return parsed.videos;
  } catch {
    return null;
  }
}

export function writeFeedCache(videos: Video[]) {
  if (typeof localStorage === "undefined") return;
  try {
    const trimmed = videos.slice(0, MAX_ITEMS);
    localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), videos: trimmed }));
  } catch {
    /* quota or private mode — caching is best-effort */
  }
}

export function clearFeedCache() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
