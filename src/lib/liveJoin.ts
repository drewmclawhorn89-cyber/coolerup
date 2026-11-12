import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type JoinStatus = "pending" | "accepted" | "rejected" | "ended";

export type JoinRequest = {
  id: string;
  live_id: string;
  requester_id: string;
  status: JoinStatus;
  created_at: string;
  responded_at: string | null;
  profile?: { handle?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

export type LiveGuest = {
  id: string;
  live_id: string;
  user_id: string;
  joined_at: string;
  is_active: boolean;
  profile?: { handle?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

/* -------------------------------------------------------------------------- */
/*  Constants                                                                 */
/* -------------------------------------------------------------------------- */

/** Host + 3 guests = a 2x2 grid. The spec allows up to 4 guests, so the grid
 *  grows to a 2x3 when the host is included on a wide screen. */
export const MAX_GUESTS = 4;

export const JOIN_STATUS_COPY: Record<JoinStatus, string> = {
  pending: "Waiting for the host…",
  accepted: "You're on LIVE",
  rejected: "The host didn't accept this time",
  ended: "Your guest spot ended",
};

/* -------------------------------------------------------------------------- */
/*  Pure helpers                                                              */
/* -------------------------------------------------------------------------- */

export function activeGuests(guests: LiveGuest[]): LiveGuest[] {
  return guests.filter((guest) => guest.is_active);
}

export function pendingRequests(requests: JoinRequest[]): JoinRequest[] {
  return requests.filter((request) => request.status === "pending");
}

export function requestName(request: JoinRequest): string {
  return request.profile?.username || request.profile?.handle || "Someone";
}

export function guestName(guest: LiveGuest): string {
  return guest.profile?.username || guest.profile?.handle || "Guest";
}

/** True when the stage has room for one more guest. */
export function stageHasRoom(guests: LiveGuest[]): boolean {
  return activeGuests(guests).length < MAX_GUESTS;
}

/**
 * Grid template for the stage.
 * 1 person fills the screen, 2 stack, 3-4 go 2x2, 5-6 go 3x2.
 */
export function guestGridClass(tiles: number): string {
  if (tiles <= 1) return "grid-cols-1 grid-rows-1";
  if (tiles === 2) return "grid-cols-1 grid-rows-2";
  if (tiles <= 4) return "grid-cols-2 grid-rows-2";
  return "grid-cols-2 grid-rows-3";
}

/** The "LIVE with @username" header line. */
export function liveWithLine(hostUsername: string, guests: LiveGuest[]): string {
  const names = activeGuests(guests).map((guest) => `@${guestName(guest)}`);
  if (names.length === 0) return `LIVE with @${hostUsername}`;
  return `LIVE with @${hostUsername} + ${names.join(", ")}`;
}

/** Banner copy for the host: "John wants to join LIVE". */
export function joinBannerText(request: JoinRequest): string {
  return `${requestName(request)} wants to join LIVE`;
}

/** "2 of 4 guest spots used". */
export function stageUsage(guests: LiveGuest[]): string {
  return `${activeGuests(guests).length} of ${MAX_GUESTS} guest spots used`;
}

/* -------------------------------------------------------------------------- */
/*  Database                                                                  */
/* -------------------------------------------------------------------------- */

const REQUEST_SELECT =
  "id, live_id, requester_id, status, created_at, responded_at, profile:profiles!live_join_requests_requester_id_fkey(handle, username, avatar_url)";

const GUEST_SELECT =
  "id, live_id, user_id, joined_at, is_active, profile:profiles!live_guests_user_id_fkey(handle, username, avatar_url)";

export type JoinResult =
  { ok: true; requestId: string } | { ok: false; message: string; stageFull?: boolean };

const JOIN_ERROR_COPY: Record<string, string> = {
  stage_full: "This LIVE already has 4 guests",
  already_on_stage: "You're already on stage",
  cannot_join_own_stream: "You're the host of this LIVE",
  not_signed_in: "Sign in to request a spot",
  host_only: "Only the host can do that",
  request_not_found: "That request is gone",
};

function readError(error: unknown): string {
  const raw = String((error as { message?: string } | null)?.message ?? error ?? "");
  for (const key of Object.keys(JOIN_ERROR_COPY)) {
    if (raw.includes(key)) return JOIN_ERROR_COPY[key]!;
  }
  return "That didn't work — try again";
}

export async function requestJoinLive(liveId: string): Promise<JoinResult> {
  const { data, error } = await supabase.rpc("request_join_live", { p_live_id: liveId });
  if (error) {
    const message = readError(error);
    return { ok: false, message, stageFull: message.includes("4 guests") };
  }
  return { ok: true, requestId: String(data) };
}

export async function loadJoinRequests(liveId: string): Promise<JoinRequest[]> {
  const { data, error } = await supabase
    .from("live_join_requests")
    .select(REQUEST_SELECT)
    .eq("live_id", liveId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data as unknown as JoinRequest[];
}

export async function loadMyRequest(liveId: string, userId: string): Promise<JoinRequest | null> {
  const { data, error } = await supabase
    .from("live_join_requests")
    .select(REQUEST_SELECT)
    .eq("live_id", liveId)
    .eq("requester_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data as unknown as JoinRequest;
}

export async function respondToJoinRequest(
  requestId: string,
  accept: boolean,
): Promise<{ ok: true; status: string } | { ok: false; message: string }> {
  const { data, error } = await supabase.rpc("respond_join_request", {
    p_request_id: requestId,
    p_accept: accept,
  });
  if (error) return { ok: false, message: readError(error) };
  return { ok: true, status: String(data) };
}

export async function loadGuests(liveId: string): Promise<LiveGuest[]> {
  const { data, error } = await supabase
    .from("live_guests")
    .select(GUEST_SELECT)
    .eq("live_id", liveId)
    .eq("is_active", true)
    .order("joined_at", { ascending: true });
  if (error || !data) return [];
  return data as unknown as LiveGuest[];
}

export async function leaveGuestStage(liveId: string, userId?: string): Promise<void> {
  await supabase
    .rpc("leave_live_guest", {
      p_live_id: liveId,
      ...(userId ? { p_user_id: userId } : {}),
    })
    .then(
      () => undefined,
      () => undefined,
    );
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

export type JoinRequestState = {
  requests: JoinRequest[];
  guests: LiveGuest[];
  pending: JoinRequest[];
  loading: boolean;
  refresh: () => Promise<void>;
};

/** Host-side: incoming requests + who is on stage. */
export function useJoinRequests(liveId: string | null, enabled = true): JoinRequestState {
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [guests, setGuests] = useState<LiveGuest[]>([]);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!liveId || !enabled) {
      setRequests([]);
      setGuests([]);
      return;
    }
    setLoading(true);
    const [nextRequests, nextGuests] = await Promise.all([
      loadJoinRequests(liveId),
      loadGuests(liveId),
    ]);
    if (!mounted.current) return;
    setLoading(false);
    setRequests(nextRequests);
    setGuests(nextGuests);
  }, [liveId, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!liveId || !enabled) return;
    const channel = supabase
      .channel(`live-join-${liveId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_join_requests",
          filter: `live_id=eq.${liveId}`,
        },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_guests", filter: `live_id=eq.${liveId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [liveId, enabled, refresh]);

  return useMemo(
    () => ({
      requests,
      guests,
      pending: pendingRequests(requests),
      loading,
      refresh,
    }),
    [requests, guests, loading, refresh],
  );
}

/** Viewer-side: my own request status for this stream. */
export function useMyJoinRequest(liveId: string | null, userId?: string | null) {
  const [requestRow, setRequestRow] = useState<JoinRequest | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!liveId || !userId) {
      setRequestRow(null);
      return;
    }
    setRequestRow(await loadMyRequest(liveId, userId));
  }, [liveId, userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const request = useCallback(async () => {
    if (!liveId) return { ok: false as const, message: "This stream isn't ready yet" };
    setBusy(true);
    const result = await requestJoinLive(liveId);
    setBusy(false);
    if (result.ok) await refresh();
    return result;
  }, [liveId, refresh]);

  const cancel = useCallback(async () => {
    if (!liveId) return;
    setBusy(true);
    await leaveGuestStage(liveId);
    await refresh();
    setBusy(false);
  }, [liveId, refresh]);

  return {
    request,
    cancel,
    busy,
    status: requestRow?.status ?? null,
    requestRow,
    refresh,
  };
}
