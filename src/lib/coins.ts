/**
 * Coolerup LIVE gifts + coins.
 *
 * Pure catalogue and maths live at the top so they can be unit tested without a
 * browser or a Supabase connection. The React hook and the send helper sit at
 * the bottom.
 *
 * Money rules (matching the product spec):
 *   100 coins  = 50 diamonds = $0.50
 *   1 diamond  = $0.01
 *   coin packs: 100 / $0.99, 500 / $4.99, 1000 / $9.99
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/* -------------------------------------------------------------------------- */
/*  Gifts                                                                     */
/* -------------------------------------------------------------------------- */

export type GiftAnimationKind = "fly" | "pop" | "spin" | "snow" | "burst";

export type LiveGift = {
  id: string;
  name: string;
  emoji: string;
  /** Price for a single gift, in coins. */
  coins: number;
  /** Which CSS animation the overlay plays. */
  kind: GiftAnimationKind;
  /** Accent colour used for the glow behind the emoji. */
  color: string;
  /** Only shown while the Christmas update is live. */
  christmasOnly?: boolean;
  /** Only offered while the GTA 6 update is live (Nov 8-15 2026, then gone). */
  gta6Only?: boolean;
};

export const LIVE_GIFTS: LiveGift[] = [
  { id: "rose", name: "Rose", emoji: "\u{1F339}", coins: 1, kind: "fly", color: "#fe2c55" },
  { id: "heart", name: "Heart", emoji: "\u{1F496}", coins: 5, kind: "pop", color: "#ff5c8a" },
  {
    id: "tiktok",
    name: "TikTok logo",
    emoji: "\u{1F3B5}",
    coins: 10,
    kind: "spin",
    color: "#25f4ee",
  },
  {
    id: "hat",
    name: "Hat and mustache",
    emoji: "\u{1F3A9}",
    coins: 20,
    kind: "pop",
    color: "#c084fc",
  },
  {
    id: "christmas",
    name: "Christmas gift",
    emoji: "\u{1F384}",
    coins: 50,
    kind: "snow",
    color: "#22c55e",
  },
  {
    id: "santa",
    name: "Santa",
    emoji: "\u{1F385}",
    coins: 75,
    kind: "snow",
    color: "#ef4444",
    christmasOnly: true,
  },
  {
    id: "gta-car",
    name: "GTA Car",
    emoji: "\u{1F697}",
    coins: 100,
    kind: "burst",
    color: "#FF2E88",
    gta6Only: true,
  },
  { id: "lion", name: "Lion", emoji: "\u{1F981}", coins: 100, kind: "burst", color: "#f59e0b" },
  {
    id: "universe",
    name: "Universe",
    emoji: "\u{1F30C}",
    coins: 500,
    kind: "burst",
    color: "#8b5cf6",
  },
];

/**
 * Gifts visible right now: Christmas items only during the Christmas update,
 * the GTA Car only during the GTA 6 update (and never again afterwards).
 */
export function giftsForMode(christmas: boolean, gta6 = false): LiveGift[] {
  return LIVE_GIFTS.filter(
    (gift) => (!gift.christmasOnly || christmas) && (!gift.gta6Only || gta6),
  );
}

export function giftById(id: string): LiveGift | undefined {
  return LIVE_GIFTS.find((gift) => gift.id === id);
}

/** Multipliers offered in the gift panel, TikTok style. */
export const GIFT_COUNTS = [1, 5, 10, 99] as const;
export type GiftCount = (typeof GIFT_COUNTS)[number];

/** Total coins for `quantity` of `gift`. */
export function giftTotal(gift: Pick<LiveGift, "coins">, quantity: number): number {
  const qty = Math.max(1, Math.min(100, Math.trunc(quantity) || 1));
  return gift.coins * qty;
}

export function canAfford(balance: number | null | undefined, cost: number): boolean {
  return typeof balance === "number" && balance >= cost;
}

/** "drewmclawhorn3 sent Rose \u{1F339} x10" */
export function giftMessage(
  username: string,
  gift: Pick<LiveGift, "name" | "emoji">,
  quantity: number,
): string {
  const qty = Math.max(1, Math.trunc(quantity) || 1);
  return `${username} sent ${gift.name} ${gift.emoji}${qty > 1 ? ` x${qty}` : ""}`;
}

/** Bigger gifts / bigger bundles get a bigger animation. */
export function animationScale(quantity: number, coins = 1): number {
  const bundle = quantity >= 10 ? 1.7 : quantity >= 5 ? 1.35 : 1;
  const value = coins >= 500 ? 1.4 : coins >= 100 ? 1.2 : 1;
  return Math.round(bundle * value * 100) / 100;
}

/** How many emoji particles to draw. Capped hard so low-end phones cope. */
export function particleCount(quantity: number, lowData: boolean): number {
  if (lowData) return 1;
  return Math.min(12, Math.max(1, Math.ceil(quantity / 2)));
}

/* -------------------------------------------------------------------------- */
/*  Coins <-> diamonds <-> dollars                                            */
/* -------------------------------------------------------------------------- */

export const DIAMONDS_PER_100_COINS = 50;
export const CENTS_PER_DIAMOND = 1;

/** 100 coins = 50 diamonds. */
export function diamondsFromCoins(coins: number): number {
  if (!Number.isFinite(coins) || coins <= 0) return 0;
  return Math.floor((coins * DIAMONDS_PER_100_COINS) / 100);
}

/** 50 diamonds = 100 coins. */
export function coinsFromDiamonds(diamonds: number): number {
  if (!Number.isFinite(diamonds) || diamonds <= 0) return 0;
  return Math.floor((diamonds * 100) / DIAMONDS_PER_100_COINS);
}

/** 1 diamond = $0.01, so 50 diamonds = $0.50. */
export function centsFromDiamonds(diamonds: number): number {
  if (!Number.isFinite(diamonds) || diamonds <= 0) return 0;
  return Math.floor(diamonds * CENTS_PER_DIAMOND);
}

export function usdFromCents(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/** What a streamer's coins are worth once converted to diamonds. */
export function earningsFromCoins(coins: number): { diamonds: number; cents: number; usd: string } {
  const diamonds = diamondsFromCoins(coins);
  const cents = centsFromDiamonds(diamonds);
  return { diamonds, cents, usd: usdFromCents(cents) };
}

/** Minimum cashout: 500 diamonds = $5.00. */
export const MIN_CASHOUT_DIAMONDS = 500;

/* -------------------------------------------------------------------------- */
/*  Coin packs                                                                */
/* -------------------------------------------------------------------------- */

export type CoinPack = {
  id: string;
  coins: number;
  cents: number;
  label: string;
  /** Marketing badge, e.g. "Best value". */
  badge?: string;
};

export const COIN_PACKS: CoinPack[] = [
  { id: "coins-100", coins: 100, cents: 99, label: "100 coins" },
  { id: "coins-500", coins: 500, cents: 499, label: "500 coins", badge: "Popular" },
  { id: "coins-1000", coins: 1000, cents: 999, label: "1,000 coins", badge: "Mega pack" },
];

export function packById(id: string): CoinPack | undefined {
  return COIN_PACKS.find((pack) => pack.id === id);
}

/** Coins per cent. Note the prices follow the spec exactly, so the small pack
 *  is the best rate per cent; badges stay descriptive rather than claiming value. */
export function coinsPerCent(pack: CoinPack): number {
  return pack.coins / pack.cents;
}

/* -------------------------------------------------------------------------- */
/*  Live gift feed helpers                                                    */
/* -------------------------------------------------------------------------- */

export type GiftFeedRow = {
  id: string;
  gift_type: string;
  coins: number;
  quantity: number;
  sender_id: string;
  created_at: string;
  sender?: { handle?: string | null; username?: string | null; avatar_url?: string | null } | null;
};

export type TopGifter = { userId: string; name: string; coins: number; gifts: number };

/** Ranks senders by coins spent in this stream. */
export function topGifters(rows: GiftFeedRow[], limit = 3): TopGifter[] {
  const totals = new Map<string, TopGifter>();
  for (const row of rows) {
    const existing = totals.get(row.sender_id);
    const name = row.sender?.username || row.sender?.handle || "guest";
    if (existing) {
      existing.coins += row.coins;
      existing.gifts += 1;
    } else {
      totals.set(row.sender_id, { userId: row.sender_id, name, coins: row.coins, gifts: 1 });
    }
  }
  return [...totals.values()].sort((a, b) => b.coins - a.coins).slice(0, limit);
}

/** The single "Top gifter: @user \u2014 500 coins" line. */
export function topGifterLine(rows: GiftFeedRow[]): string | null {
  const top = topGifters(rows, 1)[0];
  return top ? `Top gifter: @${top.name} \u2014 ${top.coins} coins` : null;
}

/** Scrolling ticker text, newest last. */
export function tickerLine(row: GiftFeedRow): string {
  const gift = giftById(row.gift_type);
  const name = row.sender?.username || row.sender?.handle || "Someone";
  return giftMessage(name, gift ?? { name: row.gift_type, emoji: "\u{1F381}" }, row.quantity);
}

/* -------------------------------------------------------------------------- */
/*  Sending                                                                   */
/* -------------------------------------------------------------------------- */

export type SendGiftResult =
  | { ok: true; giftId: string; balance: number }
  | { ok: false; message: string; needsRecharge: boolean };

const INSUFFICIENT = /insufficient_coins/i;

/**
 * Sends a gift through the `send_live_gift` Postgres function, which deducts
 * coins and writes the gift row in one transaction. `liveId` is the stream's
 * UUID, or null when the gift is not associated with a persisted live session.
 * The database derives sender_id from auth.uid() rather than trusting client text.
 */
export async function sendLiveGift(input: {
  liveId: string | null;
  receiverId: string;
  gift: LiveGift;
  quantity: number;
}): Promise<SendGiftResult> {
  const { liveId, receiverId, gift, quantity } = input;
  const qty = Math.max(1, Math.min(100, Math.trunc(quantity) || 1));
  const total = giftTotal(gift, qty);

  const { data, error } = await supabase.rpc("send_live_gift", {
    p_live_id: liveId as string,
    p_receiver_id: receiverId,
    p_gift_type: gift.id,
    p_coins: total,
    p_quantity: qty,
  });

  if (error) {
    const message = error.message || "Couldn't send that gift";
    if (INSUFFICIENT.test(message)) {
      return { ok: false, message: "Not enough coins \u2014 Recharge", needsRecharge: true };
    }
    if (/invalid_receiver/i.test(message)) {
      return { ok: false, message: "You can't send a gift to yourself", needsRecharge: false };
    }
    if (/not_signed_in/i.test(message)) {
      return { ok: false, message: "Sign in to send gifts", needsRecharge: false };
    }
    return { ok: false, message, needsRecharge: false };
  }

  const row = (Array.isArray(data) ? data[0] : data) as {
    gift_id?: string;
    balance?: number;
  } | null;
  return {
    ok: true,
    giftId: String(row?.gift_id ?? ""),
    balance: Number(row?.balance ?? 0),
  };
}

/* -------------------------------------------------------------------------- */
/*  Optional "ding"                                                           */
/* -------------------------------------------------------------------------- */

let audioCtx: AudioContext | null = null;

/** Tiny synthesised ding \u2014 no asset download, works on 1 bar. */
export function playGiftDing(coins = 1) {
  if (typeof window === "undefined") return;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  try {
    audioCtx ??= new Ctor();
    const ctx = audioCtx;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(coins >= 100 ? 1046.5 : 880, now);
    osc.frequency.exponentialRampToValueAtTime(coins >= 100 ? 1568 : 1318.5, now + 0.12);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.36);
  } catch {
    // Audio is a nicety; never let it break a gift.
  }
}

/* -------------------------------------------------------------------------- */
/*  Wallet hook                                                               */
/* -------------------------------------------------------------------------- */

export const COINS_EVENT = "loop-coins-changed";

/** Tell every mounted wallet to re-read its balance. */
export function notifyCoinsChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(COINS_EVENT));
}

export type CoinWallet = {
  balance: number | null;
  /** Diamonds earned from gifts (100 coins = 50 diamonds). */
  diamonds: number;
  /** Lifetime coins received as a streamer. */
  totalEarned: number;
  loading: boolean;
  refresh: () => Promise<void>;
  setBalance: (next: number) => void;
};

/**
 * Reads the signed-in user's wallet and keeps it fresh. Realtime is best-effort
 * (it needs the table in the realtime publication); the window event and a
 * refresh-on-focus keep the number right either way.
 */
export function useCoins(userId?: string | null): CoinWallet {
  const [balance, setBalance] = useState<number | null>(null);
  const [diamonds, setDiamonds] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
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
      setBalance(null);
      setDiamonds(0);
      setTotalEarned(0);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase
      .from("user_coins")
      .select("balance, diamonds, total_earned")
      .eq("user_id", userId)
      .maybeSingle();
    if (!mounted.current) return;
    setLoading(false);
    if (error) {
      // A missing row just means the trigger hasn't run yet; show 0, not a crash.
      setBalance((current) => current ?? 0);
      return;
    }
    const row = data as { balance?: number; diamonds?: number; total_earned?: number } | null;
    setBalance(Number(row?.balance ?? 0));
    setDiamonds(Number(row?.diamonds ?? 0));
    setTotalEarned(Number(row?.total_earned ?? 0));
  }, [userId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!userId) return;
    const onChange = () => void refresh();
    window.addEventListener(COINS_EVENT, onChange);
    window.addEventListener("focus", onChange);
    const channel = supabase
      .channel(`coins-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_coins", filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      window.removeEventListener(COINS_EVENT, onChange);
      window.removeEventListener("focus", onChange);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return useMemo(
    () => ({ balance, diamonds, totalEarned, loading, refresh, setBalance }),
    [balance, diamonds, totalEarned, loading, refresh],
  );
}

/* -------------------------------------------------------------------------- */
/*  Free 10 coins via Venmo                                                   */
/* -------------------------------------------------------------------------- */

/** Coins handed out by the daily Venmo claim. */
export const FREE_COINS_AMOUNT = 10;

/** Where the "free coins" Venmo link points. */
export const FREE_COINS_VENMO_HANDLE = "drewmclawhorn3";

/** Note the buyer's Venmo payment shows, so claims are easy to spot. */
export const FREE_COINS_NOTE = "Coolerup 10 free coins";

/**
 * Web link. Amount is 0 so opening it never charges anyone — it is proof of
 * intent, and the claim itself is what grants the coins.
 */
export function venmoFreeCoinsWebUrl(): string {
  return `https://venmo.com/${FREE_COINS_VENMO_HANDLE}?txn=pay&audience=private&amount=0&note=${encodeURIComponent(
    FREE_COINS_NOTE,
  ).replace(/%20/g, "+")}`;
}

/** App deep link, used on phones so Venmo opens instead of the browser. */
export function venmoFreeCoinsAppUrl(): string {
  return `venmo://users/${FREE_COINS_VENMO_HANDLE}`;
}

/** True on phones/tablets, where the venmo:// scheme should be tried first. */
export function isMobileDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|iemobile|blackberry|mobile/i.test(navigator.userAgent);
}

export type FreeCoinClaim = {
  id: string;
  user_id: string;
  username: string | null;
  avatar_url?: string | null;
  claimed_at: string;
  venmo_clicked: boolean;
  coins_given: number;
};

export type FreeCoinClaimState = {
  claimed: boolean;
  claimedAt?: string;
  coins?: number;
  /** Midnight UTC when the next claim unlocks. */
  nextClaimAt?: string;
};

export type ClaimFreeCoinsResult =
  | { ok: true; coins: number; balance: number; nextClaimAt: string }
  | { ok: false; message: string; alreadyClaimed: boolean; nextClaimAt?: string };

/** Milliseconds until `iso` passes; 0 when it is already in the past. */
export function msUntil(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const target = new Date(iso).getTime();
  if (!Number.isFinite(target)) return 0;
  return Math.max(0, target - now);
}

/** "5h 12m 03s" — or "12m 03s" under an hour. Always two digits on seconds. */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}h ${mm}m ${ss}s` : `${mm}m ${ss}s`;
}

/** Reads today's claim for the signed-in user (drives the countdown). */
export async function myFreeCoinClaim(): Promise<FreeCoinClaimState> {
  const { data, error } = await supabase.rpc("my_free_coin_claim");
  if (error) return { claimed: false };
  const row = (data ?? {}) as {
    claimed?: boolean;
    claimedAt?: string;
    coins?: number;
    nextClaimAt?: string;
  };
  if (!row.claimed) return { claimed: false };
  return {
    claimed: true,
    ...(row.claimedAt ? { claimedAt: row.claimedAt } : {}),
    ...(row.coins != null ? { coins: Number(row.coins) } : {}),
    ...(row.nextClaimAt ? { nextClaimAt: row.nextClaimAt } : {}),
  };
}

/**
 * Claims the daily 10 coins. The server enforces once-per-day and does the
 * wallet credit in one transaction, so this can be called safely twice.
 */
export async function claimFreeCoins(): Promise<ClaimFreeCoinsResult> {
  const { data, error } = await supabase.rpc("claim_free_coins");

  if (error) {
    if (/not_signed_in|sign in/i.test(error.message)) {
      return { ok: false, message: "Sign in to claim free coins", alreadyClaimed: false };
    }
    return {
      ok: false,
      message: error.message || "Couldn't claim your coins",
      alreadyClaimed: false,
    };
  }

  const row = (data ?? {}) as {
    ok?: boolean;
    error?: string;
    alreadyClaimed?: boolean;
    coins?: number;
    balance?: number;
    nextClaimAt?: string;
  };

  if (!row.ok) {
    return {
      ok: false,
      message: row.error ?? "Couldn't claim your coins",
      alreadyClaimed: Boolean(row.alreadyClaimed),
      ...(row.nextClaimAt ? { nextClaimAt: row.nextClaimAt } : {}),
    };
  }

  return {
    ok: true,
    coins: Number(row.coins ?? FREE_COINS_AMOUNT),
    balance: Number(row.balance ?? 0),
    nextClaimAt: String(row.nextClaimAt ?? ""),
  };
}

/** Admin view: every claim, newest first. Throws when the caller isn't admin. */
export async function adminFreeCoinClaims(limit = 200): Promise<FreeCoinClaim[]> {
  const { data, error } = await supabase.rpc("admin_free_coin_claims", { _limit: limit });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as FreeCoinClaim[]) : [];
}

export type FreeCoinStats = {
  todayCount: number;
  todayCoins: number;
  totalCount: number;
  totalCoins: number;
  topClaimers: { userId: string; name: string; claims: number; coins: number }[];
};

/** Rolls a claim list into the numbers the host dashboard shows. */
export function freeCoinStats(rows: FreeCoinClaim[], now: Date = new Date()): FreeCoinStats {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = start + 24 * 60 * 60 * 1000;
  let todayCount = 0;
  let todayCoins = 0;
  let totalCoins = 0;
  const byUser = new Map<string, { userId: string; name: string; claims: number; coins: number }>();

  for (const row of rows) {
    const at = new Date(row.claimed_at).getTime();
    const coins = Number(row.coins_given ?? FREE_COINS_AMOUNT);
    totalCoins += coins;
    if (at >= start && at < end) {
      todayCount += 1;
      todayCoins += coins;
    }
    const key = row.user_id;
    const name = row.username || "guest";
    const existing = byUser.get(key);
    if (existing) {
      existing.claims += 1;
      existing.coins += coins;
    } else {
      byUser.set(key, { userId: key, name, claims: 1, coins });
    }
  }

  const topClaimers = [...byUser.values()]
    .sort((a, b) => b.claims - a.claims || b.coins - a.coins)
    .slice(0, 3);

  return { todayCount, todayCoins, totalCount: rows.length, totalCoins, topClaimers };
}

/** "just now", "4m ago", "2h ago", "3d ago". */
export function claimAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 45) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
