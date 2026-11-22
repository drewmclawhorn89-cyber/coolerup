/**
 * Coolerup · Paid Videos
 *
 * One video can be sold on its own, short form (the For You feed) or long form
 * (the Videos tab). The rules are deliberately boring:
 *
 *   creator gets 80% of the sale, Coolerup keeps 20%
 *   100 coins = $0.50  ->  1 coin = half a cent
 *   a purchase is permanent, and a viewer is never charged twice
 *
 * The pure maths lives at the top so it can be unit tested without a browser.
 * The Supabase calls and the React hooks sit at the bottom.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { untypedDb } from "@/lib/untypedDb";
import { COINS_EVENT, notifyCoinsChanged, usdFromCents } from "@/lib/coins";

/* -------------------------------------------------------------------------- */
/*  Pricing                                                                   */
/* -------------------------------------------------------------------------- */

/** The four one-tap prices, in cents. Anything else goes through Custom. */
export const PAID_PRICE_OPTIONS = [99, 199, 299, 499] as const;

/** Matches the `price_cents between 50 and 100000` check in the migration. */
export const MIN_PAID_PRICE_CENTS = 50;
export const MAX_PAID_PRICE_CENTS = 100_000;

/** How much of a paid video anyone can watch before the lock appears. */
export const FREE_PREVIEW_SECONDS = 10;

/** Creator's cut. Kept as a number so the UI can show "You earn 80%". */
export const CREATOR_SHARE = 0.8;

export type PaidVideoKind = "short" | "full";

/** `$0.99`. Falls back to `Free` for a null/zero price. */
export function formatPriceCents(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents) || cents <= 0) return "Free";
  return usdFromCents(Math.round(cents));
}

/**
 * Turn whatever someone typed into a price in cents.
 *
 * Accepts `4.99`, `$4.99`, `4`, ` 4.99 `. Returns null when it is not a real
 * price or falls outside the range the database allows, so the caller can keep
 * the Save button disabled instead of surfacing a Postgres error.
 */
export function parseCustomPriceCents(input: string): number | null {
  const cleaned = String(input ?? "")
    .replace(/[^0-9.]/g, "")
    .trim();
  if (!cleaned || !/^\d*(\.\d{0,2})?$/.test(cleaned)) return null;
  const dollars = Number.parseFloat(cleaned);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const cents = Math.round(dollars * 100);
  if (cents < MIN_PAID_PRICE_CENTS || cents > MAX_PAID_PRICE_CENTS) return null;
  return cents;
}

/** True when a price can be stored on a paid video. */
export function isValidPaidPriceCents(cents: number | null | undefined): boolean {
  return (
    cents != null &&
    Number.isInteger(cents) &&
    cents >= MIN_PAID_PRICE_CENTS &&
    cents <= MAX_PAID_PRICE_CENTS
  );
}

/** The creator's 80%, floored — mirrors `paid_video_split()` in SQL. */
export function creatorShareCents(cents: number): number {
  const safe = Math.max(0, Math.trunc(cents) || 0);
  return Math.floor(safe * CREATOR_SHARE);
}

/** Coolerup's 20%: whatever is left after the creator is paid. */
export function platformShareCents(cents: number): number {
  const safe = Math.max(0, Math.trunc(cents) || 0);
  return safe - creatorShareCents(safe);
}

/** 1 coin = half a cent, so a $0.99 video costs 198 coins. */
export function coinsForPriceCents(cents: number): number {
  const safe = Math.max(0, Math.trunc(cents) || 0);
  return Math.ceil(safe * 2);
}

/** Creator earnings land in diamonds, and 1 diamond = 1 cent. */
export function diamondsForPriceCents(cents: number): number {
  return creatorShareCents(cents);
}

/* -------------------------------------------------------------------------- */
/*  Types                                                                     */
/* -------------------------------------------------------------------------- */

export type PurchaseResult =
  | {
      ok: true;
      alreadyOwned: boolean;
      purchaseId: string;
      amountCents: number;
      coinsSpent: number;
      creatorCents: number;
      platformCents: number;
    }
  | {
      ok: false;
      error: string;
      message: string;
      needed?: number | undefined;
      balance?: number | undefined;
    };

export type PaidVideoEarnings = {
  sales: number;
  grossCents: number;
  creatorCents: number;
  platformCents: number;
};

export type PurchasedVideo = {
  purchaseId: string;
  videoId: string;
  kind: PaidVideoKind;
  amountCents: number;
  createdAt: string;
  username: string;
  caption: string;
  videoUrl: string;
  thumbnailUrl: string | null;
};

/** Fired whenever a purchase completes, so every surface refreshes at once. */
export const PAID_VIDEO_EVENT = "loop-paid-video-changed";

export function notifyPaidVideoChanged(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PAID_VIDEO_EVENT));
    notifyCoinsChanged();
  }
}

/* -------------------------------------------------------------------------- */
/*  Ownership cache + batched lookups                                          */
/* -------------------------------------------------------------------------- */

/**
 * The feed renders 20 cards at once. Rather than one RPC per card, every card
 * that needs to know "do I own this?" queues its id on the same tick and a
 * single `my_paid_video_entitlements` call answers the whole page.
 */
const ownership = new Map<string, boolean>();
const queuedShort = new Set<string>();
const queuedFull = new Set<string>();
const ownershipListeners = new Set<() => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let entitlementsUnavailable = false;

function ownershipKey(kind: PaidVideoKind, id: string): string {
  return `${kind}:${id}`;
}

function scheduleFlush(): void {
  if (flushTimer != null || typeof window === "undefined") return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushOwnership();
  }, 0);
}

async function flushOwnership(): Promise<void> {
  const shortIds = [...queuedShort];
  const fullIds = [...queuedFull];
  queuedShort.clear();
  queuedFull.clear();
  if (shortIds.length === 0 && fullIds.length === 0) return;

  if (entitlementsUnavailable) {
    for (const id of shortIds) ownership.set(ownershipKey("short", id), false);
    for (const id of fullIds) ownership.set(ownershipKey("full", id), false);
    ownershipListeners.forEach((fn) => fn());
    return;
  }

  const { data, error } = await untypedDb.rpc("my_paid_video_entitlements", {
    p_short_ids: shortIds,
    p_full_ids: fullIds,
  });

  if (error) {
    // The migration hasn't been run yet. Treat everything as locked and stop
    // asking, so an un-migrated database doesn't spam a failing RPC.
    entitlementsUnavailable = true;
    for (const id of shortIds) ownership.set(ownershipKey("short", id), false);
    for (const id of fullIds) ownership.set(ownershipKey("full", id), false);
  } else {
    for (const id of shortIds) ownership.set(ownershipKey("short", id), false);
    for (const id of fullIds) ownership.set(ownershipKey("full", id), false);
    for (const row of (data ?? []) as Array<{ video_id: string; kind: string }>) {
      if (row?.video_id && (row.kind === "short" || row.kind === "full")) {
        ownership.set(ownershipKey(row.kind, row.video_id), true);
      }
    }
  }

  ownershipListeners.forEach((fn) => fn());
}

/** Mark a video as owned without a round trip (called right after a purchase). */
export function rememberOwned(kind: PaidVideoKind, videoId: string): void {
  ownership.set(ownershipKey(kind, videoId), true);
  ownershipListeners.forEach((fn) => fn());
}

/** Drop the cache, e.g. when the signed-in user changes. */
export function resetPaidVideoCache(): void {
  ownership.clear();
  queuedShort.clear();
  queuedFull.clear();
  entitlementsUnavailable = false;
  ownershipListeners.forEach((fn) => fn());
}

/**
 * Does the signed-in viewer own this paid video?
 *
 * Returns `false` while unknown, which is the safe answer: a paid video stays
 * locked until the database confirms the purchase. Free videos never ask.
 */
export function useVideoOwnership(
  videoId: string | null | undefined,
  kind: PaidVideoKind,
  isPaid: boolean,
): boolean {
  const key = videoId ? ownershipKey(kind, videoId) : "";
  const [owned, setOwned] = useState<boolean>(() => (key ? (ownership.get(key) ?? false) : false));

  useEffect(() => {
    if (!videoId || !isPaid) {
      setOwned(false);
      return;
    }

    const sync = () => setOwned(ownership.get(key) ?? false);
    ownershipListeners.add(sync);
    sync();

    if (!ownership.has(key) && !entitlementsUnavailable) {
      if (kind === "short") queuedShort.add(videoId);
      else queuedFull.add(videoId);
      scheduleFlush();
    }

    const onChange = () => {
      // A purchase elsewhere invalidates our answer, so ask again.
      ownership.delete(key);
      if (kind === "short") queuedShort.add(videoId);
      else queuedFull.add(videoId);
      scheduleFlush();
    };
    window.addEventListener(PAID_VIDEO_EVENT, onChange);

    return () => {
      ownershipListeners.delete(sync);
      window.removeEventListener(PAID_VIDEO_EVENT, onChange);
    };
  }, [key, videoId, kind, isPaid]);

  return isPaid ? owned : false;
}

/* -------------------------------------------------------------------------- */
/*  Buying                                                                    */
/* -------------------------------------------------------------------------- */

function purchaseErrorMessage(error: string, needed?: number, balance?: number): string {
  switch (error) {
    case "not_signed_in":
      return "Sign in to buy this video";
    case "insufficient_coins":
      return needed != null && balance != null
        ? `You need ${needed.toLocaleString()} coins, you have ${balance.toLocaleString()}`
        : "Not enough coins — recharge to keep watching";
    case "cannot_buy_own_video":
      return "This is your own video";
    case "not_a_paid_video":
      return "This video is free";
    case "video_not_found":
      return "This video is no longer available";
    case "no_wallet":
      return "Your wallet isn't ready yet — try again in a moment";
    case "card_requires_checkout":
      return "Card payments go through checkout";
    default:
      return "Couldn't complete that purchase";
  }
}

/**
 * Buy a paid video with coins. The price is read off the row by the database,
 * so nothing here can be tampered with. Buying twice returns `alreadyOwned`
 * instead of charging again.
 */
export async function purchasePaidVideoWithCoins(
  videoId: string,
  kind: PaidVideoKind,
): Promise<PurchaseResult> {
  const { data, error } = await untypedDb.rpc("purchase_paid_video", {
    p_video_id: videoId,
    p_kind: kind,
    p_paid_with: "coins",
  });

  if (error) {
    return {
      ok: false,
      error: "request_failed",
      message: error.message || "Couldn't complete that purchase",
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || row["ok"] !== true) {
    const code = String(row?.["error"] ?? "unknown");
    return {
      ok: false,
      error: code,
      message: purchaseErrorMessage(
        code,
        row?.["needed"] as number | undefined,
        row?.["balance"] as number | undefined,
      ),
      needed: (row?.["needed"] as number | undefined) ?? undefined,
      balance: (row?.["balance"] as number | undefined) ?? undefined,
    };
  }

  if (row["alreadyOwned"] !== true) notifyPaidVideoChanged();
  rememberOwned(kind, videoId);

  return {
    ok: true,
    alreadyOwned: row["alreadyOwned"] === true,
    purchaseId: String(row["purchaseId"] ?? ""),
    amountCents: Number(row["amountCents"] ?? 0),
    coinsSpent: Number(row["coinsSpent"] ?? 0),
    creatorCents: Number(row["creatorCents"] ?? 0),
    platformCents: Number(row["platformCents"] ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Earnings                                                                  */
/* -------------------------------------------------------------------------- */

const EMPTY_EARNINGS: PaidVideoEarnings = {
  sales: 0,
  grossCents: 0,
  creatorCents: 0,
  platformCents: 0,
};

export async function fetchPaidVideoEarnings(): Promise<PaidVideoEarnings> {
  const { data, error } = await untypedDb.rpc("my_paid_video_earnings");
  if (error) return EMPTY_EARNINGS;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
  if (!row || row["ok"] !== true) return EMPTY_EARNINGS;
  return {
    sales: Number(row["sales"] ?? 0),
    grossCents: Number(row["grossCents"] ?? 0),
    creatorCents: Number(row["creatorCents"] ?? 0),
    platformCents: Number(row["platformCents"] ?? 0),
  };
}

/** Creator-side totals for the wallet and Profile > Earnings. */
export function usePaidVideoEarnings(userId?: string | null) {
  const [earnings, setEarnings] = useState<PaidVideoEarnings>(EMPTY_EARNINGS);
  const [loading, setLoading] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    if (!userId) {
      setEarnings(EMPTY_EARNINGS);
      return;
    }
    setLoading(true);
    const next = await fetchPaidVideoEarnings();
    if (!mounted.current) return;
    setLoading(false);
    setEarnings(next);
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const onChange = () => void refresh();
    window.addEventListener(PAID_VIDEO_EVENT, onChange);
    window.addEventListener(COINS_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener(PAID_VIDEO_EVENT, onChange);
      window.removeEventListener(COINS_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [userId, refresh]);

  return { ...earnings, loading, refresh };
}

/* -------------------------------------------------------------------------- */
/*  Purchased shelf                                                           */
/* -------------------------------------------------------------------------- */

export async function fetchPurchasedVideos(limit = 60): Promise<PurchasedVideo[]> {
  const { data, error } = await untypedDb.rpc("my_purchased_videos", { p_limit: limit });
  if (error) return [];
  const rows = (Array.isArray(data) ? data : data ? [data] : []) as Array<Record<string, unknown>>;
  return rows
    .map((row) => ({
      purchaseId: String(row["purchase_id"] ?? ""),
      videoId: String(row["video_id"] ?? ""),
      kind: (row["kind"] === "full" ? "full" : "short") as PaidVideoKind,
      amountCents: Number(row["amount_cents"] ?? 0),
      createdAt: String(row["created_at"] ?? ""),
      username: String(row["username"] ?? ""),
      caption: String(row["caption"] ?? ""),
      videoUrl: String(row["video_url"] ?? ""),
      thumbnailUrl: (row["thumbnail_url"] as string | null) ?? null,
    }))
    .filter((row) => row.videoId);
}

/** Loads the "Purchased Videos" shelf on the profile. */
export function usePurchasedVideos(userId?: string | null, limit = 60) {
  const [videos, setVideos] = useState<PurchasedVideo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setVideos([]);
      return;
    }
    setLoading(true);
    const rows = await fetchPurchasedVideos(limit);
    setVideos(rows);
    setLoading(false);
  }, [userId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const onChange = () => void refresh();
    window.addEventListener(PAID_VIDEO_EVENT, onChange);
    return () => window.removeEventListener(PAID_VIDEO_EVENT, onChange);
  }, [userId, refresh]);

  return { videos, loading, refresh };
}

/* -------------------------------------------------------------------------- */
/*  Guard for the upload form                                                 */
/* -------------------------------------------------------------------------- */

/**
 * The two columns a paid upload writes. Free uploads write nothing at all, so
 * an un-migrated database keeps behaving exactly as before.
 */
export function paidColumns(
  isPaid: boolean,
  priceCents: number | null,
): { is_paid: boolean; price_cents: number | null } | Record<string, never> {
  if (!isPaid) return {};
  if (!isValidPaidPriceCents(priceCents)) {
    throw new Error("Pick a price between $0.50 and $1,000");
  }
  return { is_paid: true, price_cents: priceCents };
}

/** Sign-in check used before opening the purchase sheet. */
export async function currentUserId(): Promise<string | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user?.id ?? null;
}

/* -------------------------------------------------------------------------- */
/*  Profile shelves                                                           */
/* -------------------------------------------------------------------------- */

/** One row on the "My Paid Videos" shelf. */
export type MyPaidVideo = {
  id: string;
  kind: PaidVideoKind;
  title: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  priceCents: number;
};

/**
 * The creator's own paid uploads, short form and long form together. This is a
 * plain select (not an RPC) because the rows are already public; only the price
 * matters here. An un-migrated database returns an empty shelf, never a crash.
 */
export async function fetchMyPaidVideos(userId: string, limit = 60): Promise<MyPaidVideo[]> {
  if (!userId) return [];

  const [shortRes, fullRes] = await Promise.all([
    untypedDb
      .from("videos")
      .select("id, caption, video_url, price_cents, created_at")
      .eq("user_id", userId)
      .eq("is_paid", true)
      .order("created_at", { ascending: false })
      .limit(limit),
    untypedDb
      .from("full_videos")
      .select("id, title, thumbnail_url, video_url, price_cents, created_at")
      .eq("user_id", userId)
      .eq("is_paid", true)
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const shortRows = (shortRes.error ? [] : (shortRes.data ?? [])) as Array<Record<string, unknown>>;
  const fullRows = (fullRes.error ? [] : (fullRes.data ?? [])) as Array<Record<string, unknown>>;

  const mapped: MyPaidVideo[] = [
    ...shortRows.map((row) => ({
      id: String(row["id"] ?? ""),
      kind: "short" as const,
      title: String(row["caption"] ?? "").slice(0, 120),
      thumbnailUrl: null,
      videoUrl: String(row["video_url"] ?? ""),
      priceCents: Number(row["price_cents"] ?? 0),
    })),
    ...fullRows.map((row) => ({
      id: String(row["id"] ?? ""),
      kind: "full" as const,
      title: String(row["title"] ?? ""),
      thumbnailUrl: (row["thumbnail_url"] as string | null) ?? null,
      videoUrl: String(row["video_url"] ?? ""),
      priceCents: Number(row["price_cents"] ?? 0),
    })),
  ];

  return mapped.filter((row) => row.id && row.priceCents > 0);
}

/** Loads the "My Paid Videos" shelf on the profile. */
export function useMyPaidVideos(userId?: string | null, limit = 60) {
  const [videos, setVideos] = useState<MyPaidVideo[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setVideos([]);
      return;
    }
    setLoading(true);
    const rows = await fetchMyPaidVideos(userId, limit);
    setVideos(rows);
    setLoading(false);
  }, [userId, limit]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const onChange = () => void refresh();
    window.addEventListener(PAID_VIDEO_EVENT, onChange);
    window.addEventListener("focus", onChange);
    return () => {
      window.removeEventListener(PAID_VIDEO_EVENT, onChange);
      window.removeEventListener("focus", onChange);
    };
  }, [userId, refresh]);

  return { videos, loading, refresh };
}
