/**
 * Wallet, earnings and payouts.
 *
 * Everything money-related lives here so the UI never does its own arithmetic:
 * the database decides what a creator has earned, this file only formats it and
 * asks for a payout.
 *
 * MONEY RULES
 *   100 coins  = 50 diamonds = $0.50   ->  1 diamond = $0.01
 *   Cashout minimum is $10.00.
 *   Cashable = real_balance + diamonds x $0.01.
 *
 * A creator's cashable money is deliberately separate from the coin wallet:
 * coins are for gifting inside the app, this is USD you can withdraw.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeVenmoHandle } from "@/lib/venmo";

/** Dollars one diamond is worth. */
export const DIAMOND_VALUE_USD = 0.01;
/** Smallest cashout. */
export const MIN_PAYOUT = 10;
/** Diamonds needed to reach the minimum on diamonds alone. */
export const MIN_PAYOUT_DIAMONDS = Math.round(MIN_PAYOUT / DIAMOND_VALUE_USD);

export type PayoutMethod = "venmo" | "stripe";

export const PAYOUT_METHODS: { id: PayoutMethod; label: string; hint: string }[] = [
  { id: "venmo", label: "Venmo", hint: "@your-venmo" },
  { id: "stripe", label: "Stripe", hint: "you@email.com" },
];

export type Wallet = {
  diamonds: number;
  realBalance: number;
  totalEarned: number;
  coins: number;
  cashable: number;
};

export type EarningsSummary = {
  giftDiamonds: number;
  giftUsd: number;
  creatorFundUsd: number;
  followerRewardUsd: number;
  diamonds: number;
  realBalance: number;
  totalEarned: number;
  cashable: number;
};

export type GiftEarning = {
  id: string;
  giftId: string;
  diamonds: number;
  amount: number;
  createdAt: string;
  giftType: string;
  coins: number;
  quantity: number;
  liveId: string;
  senderUsername: string | null;
  senderDisplayName: string | null;
  senderAvatarUrl: string | null;
};

export type PayoutRow = {
  id: string;
  amount: number;
  diamonds: number;
  method: PayoutMethod;
  destination: string | null;
  status: "pending" | "paid" | "rejected";
  requestedAt: string;
  paidAt: string | null;
  note: string | null;
};

export type AdminPayoutRow = PayoutRow & {
  userId: string;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  currentDiamonds: number;
  currentRealBalance: number;
  totalEarned: number;
  totalViews: number;
};

export type PayoutStats = {
  pendingCount: number;
  paidCount: number;
  requestedAmount: number;
  paidAmount: number;
};

/** `1` -> `"$1.00"`, `12.5` -> `"$12.50"`. Safe on null/garbage. */
export function formatUsd(value: number | null | undefined): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? Math.max(0, n) : 0;
  return `$${safe.toFixed(2)}`;
}

/** `1234` -> `"1,234"`. Safe on null/garbage. */
export function formatDiamonds(value: number | null | undefined): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  return safe.toLocaleString("en-US");
}

/** Diamonds plus real balance, in dollars. */
export function cashableBalance(
  diamonds: number | null | undefined,
  realBalance: number | null | undefined,
): number {
  const d = Number(diamonds);
  const r = Number(realBalance);
  const safeD = Number.isFinite(d) ? Math.max(0, Math.floor(d)) : 0;
  const safeR = Number.isFinite(r) ? Math.max(0, r) : 0;
  return Math.round((safeR + safeD * DIAMOND_VALUE_USD) * 100) / 100;
}

/** True once the creator has at least $10 of cashable balance. */
export function canRequestPayout(cashable: number | null | undefined): boolean {
  const n = Number(cashable);
  return Number.isFinite(n) && n >= MIN_PAYOUT;
}

/** How many more dollars are needed before a cashout is allowed. */
export function amountToPayout(cashable: number | null | undefined): number {
  const n = Number(cashable);
  const safe = Number.isFinite(n) ? Math.max(0, n) : 0;
  return Math.max(0, Math.round((MIN_PAYOUT - safe) * 100) / 100);
}

/** Venmo link for a manual payout of a specific amount. */
export function venmoPayoutUrl(handle: string, amount: number): string {
  const recipient = normalizeVenmoHandle(handle) ?? handle.trim().replace(/^@+/, "");
  const params = new URLSearchParams({
    txn: "pay",
    recipients: recipient,
    amount: Number(amount).toFixed(2),
    note: "Coolerup creator payout",
  });
  return `https://venmo.com/?${params.toString()}`;
}

/** Fired whenever the wallet changes, so every mounted balance re-reads it. */
export const WALLET_EVENT = "loop-wallet-changed";

export function notifyWalletChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WALLET_EVENT));
}

async function rpc<T = Record<string, unknown> | null>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new Error(error.message);
  return (data ?? null) as T;
}

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

const EMPTY_WALLET: Wallet = {
  diamonds: 0,
  realBalance: 0,
  totalEarned: 0,
  coins: 0,
  cashable: 0,
};

/** Reads the signed-in user's diamonds, real balance and coin balance. */
export async function myWallet(): Promise<Wallet> {
  try {
    const data = obj(await rpc<unknown>("my_wallet"));
    if (data["ok"] === false) return EMPTY_WALLET;
    const diamonds = num(data["diamonds"]);
    const realBalance = num(data["realBalance"]);
    return {
      diamonds,
      realBalance,
      totalEarned: num(data["totalEarned"]),
      coins: num(data["coins"]),
      cashable: num(data["cashable"], cashableBalance(diamonds, realBalance)),
    };
  } catch {
    // A missing migration must never break the app.
    return EMPTY_WALLET;
  }
}

const EMPTY_SUMMARY: EarningsSummary = {
  giftDiamonds: 0,
  giftUsd: 0,
  creatorFundUsd: 0,
  followerRewardUsd: 0,
  diamonds: 0,
  realBalance: 0,
  totalEarned: 0,
  cashable: 0,
};

export async function myEarningsSummary(): Promise<EarningsSummary> {
  try {
    const data = obj(await rpc<unknown>("my_earnings_summary"));
    if (data["ok"] === false) return EMPTY_SUMMARY;
    return {
      giftDiamonds: num(data["giftDiamonds"]),
      giftUsd: num(data["giftUsd"]),
      creatorFundUsd: num(data["creatorFundUsd"]),
      followerRewardUsd: num(data["followerRewardUsd"]),
      diamonds: num(data["diamonds"]),
      realBalance: num(data["realBalance"]),
      totalEarned: num(data["totalEarned"]),
      cashable: num(data["cashable"]),
    };
  } catch {
    return EMPTY_SUMMARY;
  }
}

/** Gifts received, newest first. */
export async function myGiftEarnings(limit = 50): Promise<GiftEarning[]> {
  try {
    const data = obj(await rpc<unknown>("my_gift_earnings", { p_limit: limit }));
    return list(data["gifts"]).map((row) => ({
      id: String(row["id"] ?? ""),
      giftId: String(row["gift_id"] ?? ""),
      diamonds: num(row["diamonds"]),
      amount: num(row["amount"]),
      createdAt: String(row["created_at"] ?? ""),
      giftType: String(row["gift_type"] ?? "gift"),
      coins: num(row["coins"]),
      quantity: num(row["quantity"], 1),
      liveId: String(row["live_id"] ?? ""),
      senderUsername: str(row["sender_username"]),
      senderDisplayName: str(row["sender_display_name"]),
      senderAvatarUrl: str(row["sender_avatar_url"]),
    }));
  } catch {
    return [];
  }
}

export async function myPayouts(limit = 50): Promise<PayoutRow[]> {
  try {
    const data = obj(await rpc<unknown>("my_payouts", { p_limit: limit }));
    return list(data["payouts"]).map(mapPayout);
  } catch {
    return [];
  }
}

function mapPayout(row: Record<string, unknown>): PayoutRow {
  const status = String(row["status"] ?? "pending");
  return {
    id: String(row["id"] ?? ""),
    amount: num(row["amount"]),
    diamonds: num(row["diamonds"]),
    method: (row["method"] === "stripe" ? "stripe" : "venmo") as PayoutMethod,
    destination: str(row["destination"]),
    status: status === "paid" || status === "rejected" ? status : "pending",
    requestedAt: String(row["requested_at"] ?? ""),
    paidAt: str(row["paid_at"]),
    note: str(row["note"]),
  };
}

/**
 * Asks for a cashout. The database checks the $10 minimum and the available
 * balance, and deducts the money before the row is written, so a double tap
 * cannot overdraw the wallet.
 */
export async function requestPayout(input: {
  amount: number;
  method: PayoutMethod;
  destination: string;
}): Promise<{ ok: boolean; error?: string; amount?: number }> {
  const destination =
    input.method === "venmo"
      ? normalizeVenmoHandle(input.destination)
      : input.destination.trim().toLowerCase();
  if (!destination) {
    return {
      ok: false,
      error: input.method === "venmo" ? "Enter your Venmo username" : "Enter your Stripe email",
    };
  }
  try {
    const data = obj(
      await rpc<unknown>("request_payout", {
        p_amount: input.amount,
        p_method: input.method,
        p_destination: destination,
      }),
    );
    if (data["ok"] === false) {
      return { ok: false, error: String(data["error"] ?? "Couldn't request a payout") };
    }
    return { ok: true, amount: num(data["amount"], input.amount) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't request a payout" };
  }
}

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

export async function adminPayouts(limit = 200): Promise<AdminPayoutRow[]> {
  const data = obj(await rpc<unknown>("admin_payouts", { p_limit: limit }));
  return list(data["payouts"]).map((row) => ({
    ...mapPayout(row),
    userId: String(row["user_id"] ?? ""),
    username: String(row["username"] ?? "unknown"),
    displayName: str(row["display_name"]),
    avatarUrl: str(row["avatar_url"]),
    currentDiamonds: num(row["current_diamonds"]),
    currentRealBalance: num(row["current_real_balance"]),
    totalEarned: num(row["total_earned"]),
    totalViews: num(row["total_views"]),
  }));
}

export async function adminPayoutStats(): Promise<PayoutStats> {
  try {
    const data = obj(await rpc<unknown>("admin_payout_stats"));
    return {
      pendingCount: num(data["pendingCount"]),
      paidCount: num(data["paidCount"]),
      requestedAmount: num(data["requestedAmount"]),
      paidAmount: num(data["paidAmount"]),
    };
  } catch {
    return { pendingCount: 0, paidCount: 0, requestedAmount: 0, paidAmount: 0 };
  }
}

export async function adminMarkPayoutPaid(
  payoutId: string,
  note?: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = obj(
      await rpc<unknown>("admin_mark_creator_payout_paid", {
        p_payout_id: payoutId,
        p_note: note ?? null,
      }),
    );
    if (data["ok"] === false) {
      return { ok: false, error: String(data["error"] ?? "Couldn't mark it paid") };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't mark it paid" };
  }
}

// ---------------------------------------------------------------------------
// Live wallet
// ---------------------------------------------------------------------------

export type LiveWallet = Wallet & {
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * Live wallet for the signed-in user. Re-reads on mount, on window focus, on
 * the app-wide wallet event, and on any realtime change to the wallet row or a
 * new payout, so the number is never stale after a gift or a cashout.
 */
export function useWallet(userId?: string | null): LiveWallet {
  const [wallet, setWallet] = useState<Wallet>(EMPTY_WALLET);
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
      setWallet(EMPTY_WALLET);
      return;
    }
    setLoading(true);
    const next = await myWallet();
    if (!mounted.current) return;
    setLoading(false);
    setWallet(next);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const onEvent = () => void refresh();
    window.addEventListener(WALLET_EVENT, onEvent);
    window.addEventListener("focus", onEvent);

    const channel = supabase
      .channel(`wallet:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_balance", filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "payouts", filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe();

    return () => {
      window.removeEventListener(WALLET_EVENT, onEvent);
      window.removeEventListener("focus", onEvent);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { ...wallet, loading, refresh };
}
