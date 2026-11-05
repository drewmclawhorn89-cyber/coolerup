/**
 * Search: TikTok-style discovery for videos, people, sounds, hashtags and LIVE.
 *
 * Everything here is deliberately small and testable:
 *  - `normalizeQuery` / `sanitizeLike` keep user input from breaking PostgREST's
 *    `or(...)` filter syntax (commas and parentheses are syntax, `%` and `_` are
 *    LIKE wildcards).
 *  - the `search*` functions each do one `ilike` query, case-insensitive, and
 *    degrade to `[]` on error so a failed tab never blanks the whole page.
 *  - recent searches live in `search_history` when signed in, and in
 *    localStorage when signed out (so the feature works before signup).
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { parseCaption, type Video } from "@/lib/loop";
import type { Sound } from "@/lib/sounds";
import type { LiveHost } from "@/lib/liveDirectory";

export type SearchTab = "top" | "videos" | "users" | "sounds" | "hashtags" | "live";

/** Tab strip order, exactly like TikTok's six result tabs. */
export const SEARCH_TABS: { id: SearchTab; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "videos", label: "Videos" },
  { id: "users", label: "Users" },
  { id: "sounds", label: "Sounds" },
  { id: "hashtags", label: "Hashtags" },
  { id: "live", label: "LIVE" },
];

/** Shown before the user types anything. */
export const TRENDING_SEARCHES = [
  "Christmas 2025",
  "Coolerup LIVE",
  "funny cats",
  "fyp",
  "cooking",
  "dance challenge",
  "makeup",
  "gaming",
  "travel",
  "pet tok",
] as const;

/** Longest query we'll send to the database. */
export const MAX_QUERY_LENGTH = 80;

export type SearchUser = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type SearchHashtag = {
  tag: string;
  /** How many of the matched videos use it. */
  videos: number;
};

export type SearchResultsBundle = {
  videos: Video[];
  users: SearchUser[];
  sounds: Sound[];
  hashtags: SearchHashtag[];
};

/* -------------------------------------------------------------------------- */
/*  Query helpers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Trims, collapses whitespace and caps length. A leading `#` or `@` is kept as
 * typed (it tells us the intent) — `sanitizeLike` strips it for the query.
 */
export function normalizeQuery(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_QUERY_LENGTH);
}

/**
 * Makes a term safe to drop inside PostgREST's `or(caption.ilike.%term%)`.
 * Commas and parentheses are filter syntax; `%` and `_` are LIKE wildcards.
 * Backslashes and quotes are dropped for good measure.
 */
export function sanitizeLike(raw: string | null | undefined): string {
  return normalizeQuery(raw)
    .replace(/^[#@]+/, "")
    .replace(/[%_,()\\'"]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when the term is long enough to bother querying. */
export function isSearchable(raw: string | null | undefined): boolean {
  return sanitizeLike(raw).length > 0;
}

/** `#fyp #viral` -> `["fyp", "viral"]`, lowercased and de-duplicated. */
export function extractHashtags(caption: string | null | undefined): string[] {
  const text = parseCaption(String(caption ?? "")).text;
  const found = text.match(/#([\p{L}\p{N}_]{1,50})/gu) ?? [];
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const raw of found) {
    const tag = raw.slice(1).toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(tag);
  }
  return tags;
}

/** Counts hashtags across a result set, most-used first. */
export function hashtagsFromVideos(videos: Video[], limit = 20): SearchHashtag[] {
  const counts = new Map<string, number>();
  for (const video of videos) {
    for (const tag of extractHashtags(video.caption)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, videos: count }))
    .sort((a, b) => b.videos - a.videos || a.tag.localeCompare(b.tag))
    .slice(0, limit);
}

/** Filters the LIVE directory to hosts whose name or title matches. */
export function filterLiveHosts(hosts: LiveHost[], raw: string): LiveHost[] {
  const q = sanitizeLike(raw).toLowerCase();
  if (!q) return hosts;
  return hosts.filter(
    (host) =>
      host.username.toLowerCase().includes(q) || host.title.toLowerCase().includes(q),
  );
}

/* -------------------------------------------------------------------------- */
/*  Queries                                                                   */
/* -------------------------------------------------------------------------- */

const VIDEO_COLUMNS =
  "id, username, caption, video_url, likes_count, comments_count, shares_count, created_at, sound_id";

/** Videos whose caption, username or hashtags match. Newest + most-liked first. */
export async function searchVideos(raw: string, limit = 48): Promise<Video[]> {
  const term = sanitizeLike(raw);
  if (!term) return [];
  const { data, error } = await supabase
    .from("videos")
    .select(VIDEO_COLUMNS)
    .or(`caption.ilike.%${term}%,username.ilike.%${term}%`)
    .order("likes_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(100, limit)));
  if (error) return [];
  return (data ?? []) as unknown as Video[];
}

/** Profiles whose username, handle or display name match. */
export async function searchUsers(raw: string, limit = 30): Promise<SearchUser[]> {
  const term = sanitizeLike(raw);
  if (!term) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, display_name, avatar_url")
    .or(
      `username.ilike.%${term}%,handle.ilike.%${term}%,display_name.ilike.%${term}%`,
    )
    .limit(Math.max(1, Math.min(50, limit)));
  if (error) return [];
  return (data ?? []) as SearchUser[];
}

/** Sounds whose title or creator matches. */
export async function searchSounds(raw: string, limit = 20): Promise<Sound[]> {
  const term = sanitizeLike(raw);
  if (!term) return [];
  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .or(`title.ilike.%${term}%,creator_username.ilike.%${term}%`)
    .order("uses_count", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));
  if (error) return [];
  return (data ?? []) as Sound[];
}

/**
 * Hashtags are not their own table — they live inside captions. We search
 * videos (a `#fyp` query matches the caption) and tally the tags we find.
 */
export async function searchHashtags(raw: string, limit = 20): Promise<SearchHashtag[]> {
  const term = sanitizeLike(raw);
  if (!term) return [];
  const videos = await searchVideos(term, 100);
  const counted = hashtagsFromVideos(videos, limit);
  // Keep only tags that actually contain the term, so "#f" doesn't list #viral.
  const matching = counted.filter((tag) => tag.tag.includes(term.toLowerCase()));
  return matching.length > 0 ? matching : counted;
}

/** "You may like": a handful of profiles to suggest before anyone types. */
export async function suggestedUsers(limit = 6): Promise<SearchUser[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, handle, display_name, avatar_url")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(20, limit)));
  if (error) return [];
  return (data ?? []) as SearchUser[];
}

/** One call for the Top tab: everything at once, in parallel. */
export async function searchAll(raw: string): Promise<SearchResultsBundle> {
  const [videos, users, sounds] = await Promise.all([
    searchVideos(raw, 12),
    searchUsers(raw, 6),
    searchSounds(raw, 6),
  ]);
  return { videos, users, sounds, hashtags: hashtagsFromVideos(videos, 8) };
}

/* -------------------------------------------------------------------------- */
/*  Recent searches                                                           */
/* -------------------------------------------------------------------------- */

const LOCAL_KEY = "coolerup-search-history";
const HISTORY_LIMIT = 10;

function readLocal(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(window.localStorage.getItem(LOCAL_KEY) || "[]");
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

function writeLocal(queries: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(queries.slice(0, HISTORY_LIMIT)));
  } catch {
    /* storage full / disabled — history is a nicety, not a requirement */
  }
}

/** Most recent first. Falls back to localStorage when signed out. */
export async function loadSearchHistory(userId?: string | null): Promise<string[]> {
  if (!userId) return readLocal();
  const { data, error } = await supabase
    .from("search_history")
    .select("query")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) return readLocal();
  return (data ?? []).map((row) => row.query).filter(Boolean);
}

/** Records a search, moving an existing entry back to the top. */
export async function saveSearchTerm(userId: string | null | undefined, raw: string): Promise<void> {
  const query = normalizeQuery(raw);
  if (!query) return;

  const local = readLocal().filter((q) => q.toLowerCase() !== query.toLowerCase());
  writeLocal([query, ...local]);

  if (!userId) return;
  // Upsert on (user_id, query_key) so "Cats" and "cats" are one row.
  const { error } = await supabase.from("search_history").upsert(
    { user_id: userId, query, created_at: new Date().toISOString() },
    { onConflict: "user_id,query_key" },
  );
  if (error) {
    // Unique-violation races are harmless; anything else is non-fatal.
    return;
  }
}

/** Removes one entry from the recent list. */
export async function deleteSearchTerm(
  userId: string | null | undefined,
  raw: string,
): Promise<void> {
  const query = normalizeQuery(raw);
  if (!query) return;
  writeLocal(readLocal().filter((q) => q.toLowerCase() !== query.toLowerCase()));
  if (!userId) return;
  await supabase
    .from("search_history")
    .delete()
    .eq("user_id", userId)
    .eq("query_key", query.toLowerCase());
}

/** Wipes the recent list. */
export async function clearSearchHistory(userId?: string | null): Promise<void> {
  writeLocal([]);
  if (!userId) return;
  await supabase.from("search_history").delete().eq("user_id", userId);
}

/**
 * Recent searches, kept in sync across tabs of the app.
 * `refresh` is called after a search is recorded.
 */
export function useSearchHistory(userId?: string | null) {
  const [recent, setRecent] = useState<string[]>([]);

  const refresh = async () => {
    setRecent(await loadSearchHistory(userId));
  };

  useEffect(() => {
    let alive = true;
    void loadSearchHistory(userId).then((rows) => {
      if (alive) setRecent(rows);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  const add = async (term: string) => {
    await saveSearchTerm(userId, term);
    await refresh();
  };

  const remove = async (term: string) => {
    await deleteSearchTerm(userId, term);
    await refresh();
  };

  const clear = async () => {
    await clearSearchHistory(userId);
    setRecent([]);
  };

  return { recent, add, remove, clear, refresh };
}

/* -------------------------------------------------------------------------- */
/*  Debounce                                                                  */
/* -------------------------------------------------------------------------- */

/** Delays a value until it has been stable for `delay` ms (300ms for search). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
