/**
 * 1-hour compressed thumbnail cache.
 *
 * Feeds, grids, avatars, and inbox rows show a small compressed image first and
 * cache the resulting data URL / resolved URL for 1 hour (`THUMBNAIL_TTL_MS`)
 * so scrolling or reopening tabs does not re-download thumbnails every time.
 * Full-resolution images are only fetched / swapped in when the user taps.
 */
import { useEffect, useState } from "react";
import { resolveMediaUrl } from "./media";
import { useLowDataMode } from "./network";

/** Cache compressed thumbnails for 1 hour. */
export const THUMBNAIL_TTL_MS = 60 * 60 * 1000;

const STORAGE_KEY = "coolerup:thumb-cache:v1";
const MAX_PERSISTED_ENTRIES = 80;
const MAX_MEM_ENTRIES = 250;

export type CachedThumbnailEntry = {
  url: string;
  expiresAt: number;
};

type ThumbnailTier = "low" | "std";

const memoryCache = new Map<string, CachedThumbnailEntry>();
const inFlight = new Map<string, Promise<string>>();

function cacheKey(rawUrl: string, tier: ThumbnailTier): string {
  return `${tier}:${rawUrl}`;
}

function isDataOrBlobUrl(url: string): boolean {
  return url.startsWith("data:") || url.startsWith("blob:");
}

function loadPersistedMap(): Record<string, CachedThumbnailEntry> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, CachedThumbnailEntry>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function savePersistedMap(map: Record<string, CachedThumbnailEntry>) {
  if (typeof window === "undefined") return;
  try {
    const now = Date.now();
    const freshEntries = Object.entries(map)
      .filter(([, entry]) => entry && entry.expiresAt > now && typeof entry.url === "string")
      .sort((a, b) => b[1].expiresAt - a[1].expiresAt)
      .slice(0, MAX_PERSISTED_ENTRIES);
    const trimmed = Object.fromEntries(freshEntries);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    /* quota / private browsing — memory cache still works */
  }
}

export function getCachedThumbnailSync(
  rawUrl: string,
  tier: ThumbnailTier = "std",
  now: number = Date.now(),
): string | null {
  if (!rawUrl) return null;
  const key = cacheKey(rawUrl, tier);
  const mem = memoryCache.get(key);
  if (mem) {
    if (mem.expiresAt > now) return mem.url;
    memoryCache.delete(key);
  }
  const persisted = loadPersistedMap();
  const hit = persisted[key];
  if (hit && hit.expiresAt > now && typeof hit.url === "string") {
    memoryCache.set(key, hit);
    return hit.url;
  }
  return null;
}

export function setCachedThumbnail(
  rawUrl: string,
  resolvedUrl: string,
  tier: ThumbnailTier = "std",
  ttlMs: number = THUMBNAIL_TTL_MS,
  now: number = Date.now(),
): void {
  if (!rawUrl || !resolvedUrl) return;
  const key = cacheKey(rawUrl, tier);
  const entry: CachedThumbnailEntry = {
    url: resolvedUrl,
    expiresAt: now + ttlMs,
  };
  if (memoryCache.size >= MAX_MEM_ENTRIES) {
    const oldestKey = memoryCache.keys().next().value;
    if (oldestKey) memoryCache.delete(oldestKey);
  }
  memoryCache.set(key, entry);

  // Only persist reasonably sized strings so we never blow up localStorage.
  if (resolvedUrl.length <= 45_000) {
    const persisted = loadPersistedMap();
    persisted[key] = entry;
    savePersistedMap(persisted);
  }
}

export function clearExpiredThumbnails(now: number = Date.now()): void {
  for (const [k, v] of memoryCache.entries()) {
    if (v.expiresAt <= now) memoryCache.delete(k);
  }
  const persisted = loadPersistedMap();
  let changed = false;
  for (const [k, v] of Object.entries(persisted)) {
    if (!v || v.expiresAt <= now) {
      delete persisted[k];
      changed = true;
    }
  }
  if (changed) savePersistedMap(persisted);
}

export function clearThumbnailCache(): void {
  memoryCache.clear();
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Downscale and JPEG-compress an image URL to a small thumbnail.
 * Safely falls back to the input URL when canvas compression is unavailable
 * (e.g. CORS-restricted host, SVG, or jsdom test environment).
 */
export async function compressImageToThumbnail(
  url: string,
  opts: { maxDim?: number; quality?: number } = {},
): Promise<string> {
  if (!url || typeof document === "undefined" || isDataOrBlobUrl(url)) {
    return url;
  }
  const maxDim = opts.maxDim ?? 320;
  const quality = opts.quality ?? 0.68;

  return new Promise<string>((resolve) => {
    let settled = false;
    const finish = (out: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(out);
    };
    const timer = window.setTimeout(() => finish(url), 3500);

    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "async";
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width;
          const h = img.naturalHeight || img.height;
          if (!w || !h) {
            finish(url);
            return;
          }
          const scale = Math.min(1, maxDim / Math.max(w, h));
          const targetW = Math.max(1, Math.round(w * scale));
          const targetH = Math.max(1, Math.round(h * scale));
          const canvas = document.createElement("canvas");
          canvas.width = targetW;
          canvas.height = targetH;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            finish(url);
            return;
          }
          ctx.drawImage(img, 0, 0, targetW, targetH);
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          // Only adopt the compressed data URL if it actually succeeded & isn't huge.
          if (dataUrl && dataUrl.startsWith("data:image/") && dataUrl.length < 42_000) {
            finish(dataUrl);
          } else {
            finish(url);
          }
        } catch {
          finish(url);
        }
      };
      img.onerror = () => finish(url);
      img.src = url;
    } catch {
      finish(url);
    }
  });
}

/**
 * Resolve & compress an image/thumbnail URL and cache it for 1 hour.
 * Video URLs pass through `resolveMedia` and are cached for 1 hour without
 * canvas compression.
 */
export async function getOrCreateCachedThumbnail(
  rawUrl: string,
  opts: {
    isVideo?: boolean | undefined;
    lowData?: boolean | undefined;
    maxDim?: number | undefined;
  } = {},
): Promise<string> {
  if (!rawUrl) return "";
  const lowData = opts.lowData ?? false;
  const tier: ThumbnailTier = lowData ? "low" : "std";
  const cached = getCachedThumbnailSync(rawUrl, tier);
  if (cached) return cached;

  const inflightKey = cacheKey(rawUrl, tier);
  const existing = inFlight.get(inflightKey);
  if (existing) return existing;

  const work = (async () => {
    try {
      const resolved = await resolveMediaUrl(rawUrl);
      if (!resolved) return "";
      if (opts.isVideo) {
        setCachedThumbnail(rawUrl, resolved, tier);
        return resolved;
      }
      const compressed = await compressImageToThumbnail(resolved, {
        maxDim: opts.maxDim ?? (lowData ? 180 : 320),
        quality: lowData ? 0.5 : 0.68,
      });
      setCachedThumbnail(rawUrl, compressed || resolved, tier);
      return compressed || resolved;
    } catch {
      return "";
    } finally {
      inFlight.delete(inflightKey);
    }
  })();

  inFlight.set(inflightKey, work);
  return work;
}

/**
 * React hook for showing a 1-hour cached compressed thumbnail first.
 * When `fullRes` is true, returns the resolved full-resolution media URL instead.
 */
export function useCompressedThumbnail(
  rawUrl: string | null | undefined,
  opts: { isVideo?: boolean; fullRes?: boolean; maxDim?: number; enabled?: boolean } = {},
): string {
  const lowData = useLowDataMode();
  const tier: ThumbnailTier = lowData ? "low" : "std";
  const enabled = opts.enabled !== false;

  const [src, setSrc] = useState<string>(() => {
    if (!rawUrl || !enabled) return "";
    if (!rawUrl.startsWith("storage:")) {
      return getCachedThumbnailSync(rawUrl, tier) ?? rawUrl;
    }
    return getCachedThumbnailSync(rawUrl, tier) ?? "";
  });

  useEffect(() => {
    if (!rawUrl || !enabled) {
      setSrc("");
      return;
    }
    let cancelled = false;
    if (opts.fullRes) {
      void resolveMediaUrl(rawUrl).then((resolved) => {
        if (!cancelled && resolved) setSrc(resolved);
      });
      return () => {
        cancelled = true;
      };
    }

    const hit = getCachedThumbnailSync(rawUrl, tier);
    if (hit) {
      setSrc(hit);
      return;
    }

    if (!rawUrl.startsWith("storage:")) {
      setSrc(rawUrl);
    }

    void getOrCreateCachedThumbnail(rawUrl, {
      isVideo: opts.isVideo,
      lowData,
      maxDim: opts.maxDim,
    }).then((result) => {
      if (!cancelled && result) setSrc(result);
    });

    return () => {
      cancelled = true;
    };
  }, [enabled, lowData, opts.fullRes, opts.isVideo, opts.maxDim, rawUrl, tier]);

  return src;
}
