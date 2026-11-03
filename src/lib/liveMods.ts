import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type LiveRole = "host" | "mod" | "viewer";

export type LiveMod = {
  id: string;
  live_id: string;
  user_id: string;
  added_by: string;
  created_at: string;
  profile?: { handle?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

export type LiveMute = {
  id: string;
  live_id: string;
  user_id: string;
  muted_by: string;
  /** null means permanent for the rest of the stream. */
  until: string | null;
  created_at: string;
  profile?: { handle?: string | null; username?: string | null } | null;
};

export type PinnedMessage = {
  id: string;
  username: string;
  body: string;
  at: number;
};

export type LiveRoomState = {
  live_id: string;
  comments_off: boolean;
  pinned: PinnedMessage | null;
};

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

/** TikTok caps a room at 20 moderators; so do we. */
export const MAX_MODS = 20;

export const MUTE_OPTIONS = [
  { id: "5", label: "Mute 5 minutes", minutes: 5 },
  { id: "10", label: "Mute 10 minutes", minutes: 10 },
  { id: "permanent", label: "Mute permanently", minutes: null },
] as const;

export type MuteOptionId = (typeof MUTE_OPTIONS)[number]["id"];

/* -------------------------------------------------------------------------- */
/*  Pure helpers                                                              */
/* -------------------------------------------------------------------------- */

/** Who is this user in this room? */
export function roleFor(input: {
  hostId?: string | null;
  userId?: string | null;
  mods: Pick<LiveMod, "user_id">[];
}): LiveRole {
  const { hostId, userId, mods } = input;
  if (!userId) return "viewer";
  if (hostId && userId === hostId) return "host";
  return mods.some((mod) => mod.user_id === userId) ? "mod" : "viewer";
}

/** Hosts and mods can mute, block, pin and switch comments off. */
export function canModerate(role: LiveRole): boolean {
  return role === "host" || role === "mod";
}

/** Only the host can add or remove moderators. */
export function canManageMods(role: LiveRole): boolean {
  return role === "host";
}

/** A mute with no `until` never expires. */
export function muteIsActive(mute: Pick<LiveMute, "until">, now = Date.now()): boolean {
  if (!mute.until) return true;
  return new Date(mute.until).getTime() > now;
}

/** Finds the mute that currently applies to a user, if any. */
export function activeMuteFor(
  mutes: LiveMute[],
  userId: string | null | undefined,
  now = Date.now(),
): LiveMute | null {
  if (!userId) return null;
  return mutes.find((mute) => mute.user_id === userId && muteIsActive(mute, now)) ?? null;
}

/** "5m" / "10m" / "permanent" — the small grey suffix next to a muted name. */
export function muteLabel(mute: Pick<LiveMute, "until">, now = Date.now()): string {
  if (!mute.until) return "permanent";
  const minutes = Math.max(1, Math.round((new Date(mute.until).getTime() - now) / 60000));
  return `${minutes}m`;
}

/** The chat announcement when someone is promoted. */
export function modAnnouncement(username: string): string {
  return `@${username} is now moderator 🛡️`;
}

/** The chat announcement when a moderator is removed. */
export function unmodAnnouncement(username: string): string {
  return `@${username} is no longer a moderator`;
}

/** The chat announcement when someone is muted. */
export function muteAnnouncement(username: string, mute: Pick<LiveMute, "until">): string {
  return `@${username} was muted (${muteLabel(mute)})`;
}

export function blockAnnouncement(username: string): string {
  return `@${username} was removed from this LIVE`;
}

/** Name shown for a moderator: blue, with a shield. */
export function displayName(profile: { username?: string | null; handle?: string | null }): string {
  return profile.username || profile.handle || "guest";
}

/* -------------------------------------------------------------------------- */
/*  Database                                                                  */
/* -------------------------------------------------------------------------- */

const MOD_SELECT =
  "id, live_id, user_id, added_by, created_at, profile:profiles!live_mods_user_id_fkey(handle, username, avatar_url)";

const MUTE_SELECT =
  "id, live_id, user_id, muted_by, until, created_at, profile:profiles!live_mutes_user_id_fkey(handle, username)";

export async function loadMods(liveId: string): Promise<LiveMod[]> {
  const { data, error } = await supabase
    .from("live_mods")
    .select(MOD_SELECT)
    .eq("live_id", liveId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as unknown as LiveMod[];
}

export async function loadMutes(liveId: string): Promise<LiveMute[]> {
  const { data, error } = await supabase
    .from("live_mutes")
    .select(MUTE_SELECT)
    .eq("live_id", liveId)
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as unknown as LiveMute[];
}

export async function loadRoomState(liveId: string): Promise<LiveRoomState> {
  const { data } = await supabase
    .from("live_room_state")
    .select("live_id, comments_off, pinned")
    .eq("live_id", liveId)
    .maybeSingle();
  const row = data as {
    live_id?: string;
    comments_off?: boolean;
    pinned?: PinnedMessage | null;
  } | null;
  return {
    live_id: liveId,
    comments_off: Boolean(row?.comments_off),
    pinned: row?.pinned ?? null,
  };
}

export type ModActionResult = { ok: true; count?: number } | { ok: false; message: string };

const ERROR_COPY: Record<string, string> = {
  host_only: "Only the host can do that",
  moderator_only: "Only the host or a moderator can do that",
  mod_limit_reached: `You can have at most ${MAX_MODS} moderators`,
  cannot_mod_yourself: "You can't moderate yourself",
  cannot_mute_self_or_host: "You can't mute yourself or the host",
  not_signed_in: "Sign in first",
};

function readError(error: unknown): string {
  const raw = String((error as { message?: string } | null)?.message ?? error ?? "");
  for (const key of Object.keys(ERROR_COPY)) {
    if (raw.includes(key)) return ERROR_COPY[key]!;
  }
  return "That didn't work — try again";
}

export async function addModerator(liveId: string, userId: string): Promise<ModActionResult> {
  const { data, error } = await supabase.rpc("add_live_mod", {
    p_live_id: liveId,
    p_user_id: userId,
  });
  if (error) return { ok: false, message: readError(error) };
  return { ok: true, count: Number(data ?? 0) };
}

export async function removeModerator(liveId: string, userId: string): Promise<ModActionResult> {
  const { data, error } = await supabase.rpc("remove_live_mod", {
    p_live_id: liveId,
    p_user_id: userId,
  });
  if (error) return { ok: false, message: readError(error) };
  return { ok: true, count: Number(data ?? 0) };
}

export async function muteUser(
  liveId: string,
  userId: string,
  minutes: number | null,
): Promise<ModActionResult> {
  const { error } = await supabase.rpc("mute_live_user", {
    p_live_id: liveId,
    p_user_id: userId,
    p_minutes: minutes ?? undefined,
  });
  if (error) return { ok: false, message: readError(error) };
  return { ok: true };
}

export async function unmuteUser(liveId: string, userId: string): Promise<ModActionResult> {
  const { error } = await supabase.rpc("unmute_live_user", {
    p_live_id: liveId,
    p_user_id: userId,
  });
  if (error) return { ok: false, message: readError(error) };
  return { ok: true };
}

export async function setCommentsOff(liveId: string, off: boolean): Promise<ModActionResult> {
  const { error } = await supabase.rpc("set_live_comments", {
    p_live_id: liveId,
    p_off: off,
  });
  if (error) return { ok: false, message: readError(error) };
  return { ok: true };
}

export async function pinMessage(
  liveId: string,
  message: PinnedMessage | null,
): Promise<ModActionResult> {
  const { error } = await supabase.rpc("pin_live_message", {
    p_live_id: liveId,
    p_message: message,
  });
  if (error) return { ok: false, message: readError(error) };
  return { ok: true };
}

export async function endLiveSession(liveId: string): Promise<void> {
  await supabase.rpc("end_live_session", { p_live_id: liveId }).then(
    () => undefined,
    () => undefined,
  );
}

/** Followers of the host, for the "Add moderator" search. */
export async function searchFollowers(
  handle: string,
  query: string,
): Promise<{ id: string; handle: string; username: string | null; avatar_url: string | null }[]> {
  const term = query.trim().replace(/^@/, "");
  if (!handle) return [];

  const { data: following, error } = await supabase
    .from("follows")
    .select("following_username")
    .eq("follower_username", handle)
    .limit(300);
  if (error || !following?.length) return [];

  const handles = following
    .map((row) => (row as { following_username?: string }).following_username)
    .filter((value): value is string => Boolean(value));
  if (handles.length === 0) return [];

  let request = supabase
    .from("profiles")
    .select("id, handle, username, avatar_url")
    .in("handle", handles)
    .limit(20);
  if (term) request = request.or(`handle.ilike.%${term}%,username.ilike.%${term}%`);

  const { data, error: profileError } = await request;
  if (profileError || !data) return [];
  return data as {
    id: string;
    handle: string;
    username: string | null;
    avatar_url: string | null;
  }[];
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

export type LiveModerationState = {
  mods: LiveMod[];
  mutes: LiveMute[];
  commentsOff: boolean;
  pinned: PinnedMessage | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setPinned: (message: PinnedMessage | null) => void;
  setCommentsOffLocal: (off: boolean) => void;
  setMods: (mods: LiveMod[]) => void;
};

/**
 * Keeps the mod list, mute list and room state in sync for one stream.
 * Realtime is best effort — a failed subscription still leaves the explicit
 * refresh the caller runs after every moderation action.
 */
export function useLiveModeration(liveId: string | null): LiveModerationState {
  const [mods, setMods] = useState<LiveMod[]>([]);
  const [mutes, setMutes] = useState<LiveMute[]>([]);
  const [commentsOff, setCommentsOff] = useState(false);
  const [pinned, setPinned] = useState<PinnedMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!liveId) {
      setMods([]);
      setMutes([]);
      setCommentsOff(false);
      setPinned(null);
      return;
    }
    setLoading(true);
    const [nextMods, nextMutes, state] = await Promise.all([
      loadMods(liveId),
      loadMutes(liveId),
      loadRoomState(liveId),
    ]);
    if (!mounted.current) return;
    setLoading(false);
    setMods(nextMods);
    setMutes(nextMutes);
    setCommentsOff(state.comments_off);
    setPinned(state.pinned);
  }, [liveId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!liveId) return;
    const channel = supabase
      .channel(`live-moderation-${liveId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_mods", filter: `live_id=eq.${liveId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_mutes", filter: `live_id=eq.${liveId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_room_state", filter: `live_id=eq.${liveId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [liveId, refresh]);

  return useMemo(
    () => ({
      mods,
      mutes,
      commentsOff,
      pinned,
      loading,
      refresh,
      setPinned,
      setCommentsOffLocal: setCommentsOff,
      setMods,
    }),
    [mods, mutes, commentsOff, pinned, loading, refresh],
  );
}
