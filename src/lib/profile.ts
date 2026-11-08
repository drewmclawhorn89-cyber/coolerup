import { supabase } from "@/integrations/supabase/client";
import type { Video } from "@/lib/loop";

/**
 * Profile data layer.
 *
 * Every profile number is a `count: "exact", head: true` query, so the value is
 * the real total no matter how many rows exist. Previously the profile derived
 * its numbers from fetched arrays, which silently stopped at Supabase's 1000
 * row response cap — a creator with 1,542 videos showed "1000".
 *
 * Grids are paged with `.range(from, to)` instead of `.limit(n)`, so infinite
 * scroll can walk the whole library (30 at a time) rather than a truncated list.
 */

/** Cards fetched per infinite-scroll page. */
export const PROFILE_PAGE_SIZE = 30;

export type ProfileCounts = {
  /** Videos the user has posted. */
  videos: number;
  /** Videos the user has liked (their Liked tab). */
  likes: number;
  /** Videos the user has reposted. */
  reposts: number;
  /** Videos the user has saved. */
  saved: number;
  /** Accounts following this user. */
  followers: number;
  /** Accounts this user follows. */
  following: number;
  /** Total likes received across all their videos. */
  likesReceived: number;
};

export const EMPTY_PROFILE_COUNTS: ProfileCounts = {
  videos: 0,
  likes: 0,
  reposts: 0,
  saved: 0,
  followers: 0,
  following: 0,
  likesReceived: 0,
};

type CountTable = "videos" | "likes" | "reposts" | "saved_videos" | "follows";

/** Exact head-count for a table filtered by one equality match. */
async function headCount(table: CountTable, column: string, value: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq(column, value);
  if (error) return 0;
  return count ?? 0;
}

/**
 * Sum of `likes_count` across every video a user posted. Paged so the total is
 * complete even past the 1000 row response cap.
 */
export async function fetchLikesReceived(username: string): Promise<number> {
  const PAGE = 1000;
  let total = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("videos")
      .select("likes_count")
      .eq("username", username)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) break;
    const rows = (data ?? []) as { likes_count: number | null }[];
    total += rows.reduce((sum, row) => sum + (row.likes_count ?? 0), 0);
    if (rows.length < PAGE) break;
  }
  return total;
}

/**
 * All profile numbers in one shot. Works for any profile — the counts are
 * independent of who is viewing.
 */
export async function fetchProfileCounts(
  profileId: string,
  username: string,
): Promise<ProfileCounts> {
  const [videos, likes, reposts, saved, followers, following, likesReceived] = await Promise.all([
    headCount("videos", "username", username),
    headCount("likes", "user_id", profileId),
    headCount("reposts", "user_id", profileId),
    headCount("saved_videos", "user_id", profileId),
    headCount("follows", "following_username", username),
    headCount("follows", "follower_username", username),
    fetchLikesReceived(username),
  ]);
  return { videos, likes, reposts, saved, followers, following, likesReceived };
}

/** One page of a user's own videos, newest first. */
export async function fetchProfileVideosPage(
  username: string,
  offset: number,
  limit = PROFILE_PAGE_SIZE,
): Promise<{ rows: Video[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .eq("username", username)
    .order("created_at", { ascending: false })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = (data ?? []) as unknown as Video[];
  return { rows, hasMore: rows.length === limit };
}

/** One page of videos a user liked, newest like first. */
export async function fetchLikedVideosPage(
  userId: string,
  offset: number,
  limit = PROFILE_PAGE_SIZE,
): Promise<{ rows: Video[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from("likes")
    .select("created_at, videos(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as { videos: Video | null }[])
    .map((row) => row.videos)
    .filter((v): v is Video => !!v)
    .map((v) => ({ ...v, reposts: v.reposts_count ?? 0 }));
  return { rows, hasMore: (data ?? []).length === limit };
}

/** One page of videos a user saved, newest save first. */
export async function fetchSavedVideosPage(
  userId: string,
  offset: number,
  limit = PROFILE_PAGE_SIZE,
): Promise<{ rows: Video[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from("saved_videos")
    .select("created_at, videos(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as { videos: Video | null }[])
    .map((row) => row.videos)
    .filter((v): v is Video => !!v);
  return { rows, hasMore: (data ?? []).length === limit };
}

/** One page of videos a user reposted, newest repost first. */
export async function fetchRepostedVideosPage(
  userId: string,
  offset: number,
  limit = PROFILE_PAGE_SIZE,
): Promise<{ rows: Video[]; hasMore: boolean }> {
  const { data, error } = await supabase
    .from("reposts")
    .select("created_at, videos(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const rows = ((data ?? []) as unknown as { videos: Video | null }[])
    .map((row) => row.videos)
    .filter((v): v is Video => !!v)
    .map((v) => ({ ...v, reposts: v.reposts_count ?? 0 }));
  return { rows, hasMore: (data ?? []).length === limit };
}

/**
 * TikTok-style compact number: 942 -> "942", 1542 -> "1.5K", 12500 -> "12.5K",
 * 1_240_000 -> "1.2M". The exact value always stays in the data layer; this is
 * only for display.
 */
export function formatProfileCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.trunc(n));
  if (n < 1_000_000) return `${trimZero((n / 1000).toFixed(1))}K`;
  if (n < 1_000_000_000) return `${trimZero((n / 1_000_000).toFixed(1))}M`;
  return `${trimZero((n / 1_000_000_000).toFixed(1))}B`;
}

function trimZero(value: string): string {
  return value.endsWith(".0") ? value.slice(0, -2) : value;
}
