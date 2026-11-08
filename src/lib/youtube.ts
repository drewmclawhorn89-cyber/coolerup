import { supabase } from "@/integrations/supabase/client";

export type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  channelTitle: string;
  thumbnailUrl: string;
  publishedAt: string;
  durationSeconds: number;
  viewCount: string;
};

type SearchResponse = { items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string; channelTitle?: string; publishedAt?: string; thumbnails?: { high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } } }> }> };
type DetailsResponse = { items?: Array<{ id: string; contentDetails?: { duration?: string }; statistics?: { viewCount?: string } }> };
type CacheRow = { videos: YouTubeVideo[]; expires_at: string };
const CACHE_TTL_MS = 60 * 60 * 1000;

function apiKey(): string {
  const key = import.meta.env.VITE_YOUTUBE_API_KEY;
  if (!key) throw new Error("YouTube search is not configured. Set VITE_YOUTUBE_API_KEY.");
  return key;
}

function parseDuration(value = ""): number {
  const match = value.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

/** Search the official YouTube Data API and cache metadata for one hour. */
export async function searchYouTubeVideos(query: string, signal?: AbortSignal): Promise<YouTubeVideo[]> {
  const normalized = query.trim().replace(/\s+/g, " ").toLowerCase();
  if (!normalized) return [];
  const cacheKey = normalized;
  const db = supabase as any;
  try {
    const { data } = await db.from("youtube_cache").select("videos, expires_at").eq("query", cacheKey).maybeSingle();
    const cached = data as CacheRow | null;
    if (cached && new Date(cached.expires_at).getTime() > Date.now() && Array.isArray(cached.videos)) return cached.videos;
  } catch { /* The API can still serve results if the cache table isn't migrated yet. */ }

  const key = apiKey();
  const params = new URLSearchParams({ part: "snippet", q: query.trim(), type: "video", maxResults: "12", videoEmbeddable: "true", key });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal });
  if (!response.ok) throw new Error(response.status === 403 ? "YouTube search quota or API access is unavailable." : "Could not search YouTube.");
  const search = (await response.json()) as SearchResponse;
  const videos = (search.items ?? []).flatMap((item) => {
    const id = item.id?.videoId;
    const snippet = item.snippet;
    if (!id || !snippet) return [];
    return [{ id, title: snippet.title ?? "Untitled video", description: snippet.description ?? "", channelTitle: snippet.channelTitle ?? "YouTube creator", thumbnailUrl: snippet.thumbnails?.high?.url ?? snippet.thumbnails?.medium?.url ?? snippet.thumbnails?.default?.url ?? `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, publishedAt: snippet.publishedAt ?? "", durationSeconds: 0, viewCount: "" }];
  });

  if (videos.length) {
    const detailParams = new URLSearchParams({ part: "contentDetails,statistics", id: videos.map((video) => video.id).join(","), key });
    const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`, { signal });
    if (detailResponse.ok) {
      const details = (await detailResponse.json()) as DetailsResponse;
      const byId = new Map((details.items ?? []).map((item) => [item.id, item]));
      for (const video of videos) {
        const detail = byId.get(video.id);
        video.durationSeconds = parseDuration(detail?.contentDetails?.duration);
        video.viewCount = detail?.statistics?.viewCount ?? "";
      }
    }
  }

  const expiresAt = new Date(Date.now() + CACHE_TTL_MS).toISOString();
  try {
    await db.from("youtube_cache").upsert({ query: cacheKey, videos, cached_at: new Date().toISOString(), expires_at: expiresAt }, { onConflict: "query" });
  } catch { /* Cache is an optimization, not a prerequisite for search. */ }
  return videos;
}
