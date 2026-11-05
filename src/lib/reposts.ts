import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Reposts ("🔁 Repost") are a single row per (user, video) in the `reposts`
 * table. Everything that touches that table lives here so the feed, the video
 * card and the profile tabs all agree on the shape of the data.
 */

export type Repost = {
  id: string;
  user_id: string;
  video_id: string;
  created_at: string;
};

/** localStorage key shared with the feed (`src/routes/index.tsx`). */
export const NOT_INTERESTED_KEY = "loop-not-interested";
/** Fired on `window` whenever the not-interested list changes. */
export const NOT_INTERESTED_EVENT = "loop-not-interested-changed";

/** 23505 = unique_violation, i.e. this user already reposted the video. */
const UNIQUE_VIOLATION = "23505";

/** Has `userId` reposted `videoId`? */
export async function isReposted(videoId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("reposts")
    .select("id")
    .eq("video_id", videoId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return false;
  return !!data;
}

/** Every video id the given user has reposted (used to hydrate the feed). */
export async function fetchRepostedVideoIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from("reposts").select("video_id").eq("user_id", userId);
  if (error) return [];
  return ((data ?? []) as { video_id: string }[]).map((r) => r.video_id);
}

/**
 * Create the repost row. Re-reposting is a no-op rather than an error, so the
 * optimistic UI never has to roll back for a double tap.
 */
export async function repostVideo(videoId: string, userId: string): Promise<boolean> {
  const { error } = await supabase.from("reposts").insert({ video_id: videoId, user_id: userId });
  if (error && error.code !== UNIQUE_VIOLATION) return false;
  return true;
}

/** Remove the repost row. Deleting a row that isn't there is fine. */
export async function unrepostVideo(videoId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from("reposts")
    .delete()
    .eq("video_id", videoId)
    .eq("user_id", userId);
  return !error;
}

/** Flip the repost state and return what the new state should be. */
export async function toggleRepost(
  videoId: string,
  userId: string,
  currentlyReposted: boolean,
): Promise<boolean> {
  const ok = currentlyReposted
    ? await unrepostVideo(videoId, userId)
    : await repostVideo(videoId, userId);
  return ok ? !currentlyReposted : currentlyReposted;
}

/** Track whether the signed-in user has reposted a single video. */
export function useReposted(videoId: string, userId: string | null | undefined) {
  const [reposted, setReposted] = useState(false);
  const [loading, setLoading] = useState(!!userId);

  useEffect(() => {
    if (!userId) {
      setReposted(false);
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void isReposted(videoId, userId).then((value) => {
      if (!active) return;
      setReposted(value);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [videoId, userId]);

  return { reposted, setReposted, loading };
}

// --- "Not interested" -------------------------------------------------------
// Kept in localStorage so it survives reloads without a server round trip. The
// feed listens for NOT_INTERESTED_EVENT and filters these ids out.

function readNotInterested(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(NOT_INTERESTED_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeNotInterested(ids: string[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NOT_INTERESTED_KEY, JSON.stringify(ids));
    window.dispatchEvent(new Event(NOT_INTERESTED_EVENT));
  } catch {
    /* storage full or blocked — nothing we can do */
  }
}

export function isNotInterested(videoId: string): boolean {
  return readNotInterested().includes(videoId);
}

/** Hide a video from the feed for this browser. */
export function markNotInterested(videoId: string) {
  const ids = readNotInterested();
  if (ids.includes(videoId)) return;
  writeNotInterested([...ids, videoId]);
}

/** Undo a "Not interested" (used by the settings screen). */
export function clearNotInterested(videoId?: string) {
  if (!videoId) {
    writeNotInterested([]);
    return;
  }
  writeNotInterested(readNotInterested().filter((id) => id !== videoId));
}

/** React hook: is this video hidden for the current browser? */
export function useNotInterested(videoId: string) {
  const [hidden, setHidden] = useState(() => isNotInterested(videoId));
  const hide = useCallback(() => {
    markNotInterested(videoId);
    setHidden(true);
  }, [videoId]);
  return { hidden, hide };
}
