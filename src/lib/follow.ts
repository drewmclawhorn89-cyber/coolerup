/**
 * Follows and the creator-fund reward.
 *
 * Reaching your first follower pays $1.00 of real, cashable money. The payout
 * itself is decided in the database (a trigger on `follows` plus a unique index
 * on `follower_rewards.user_id`), so nothing here can create money — this file
 * only performs the follow and reads back what the database decided.
 *
 * Real money is tracked separately from the coin wallet on purpose: coins are
 * for gifting inside the app, `real_balance` is USD you can cash out.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { normalizeVenmoHandle } from "@/lib/venmo";

/** Dollars paid for the first follower. */
export const FOLLOWER_REWARD_AMOUNT = 1;
/** Smallest real balance that can be cashed out. */
export const MIN_REAL_CASHOUT = 1;

export type FollowerReward = {
  rewardId: string;
  username: string | null;
  followerCount: number;
  rewardAmount: number;
  claimed: boolean;
  createdAt: string | null;
  payoutRequestedAt: string | null;
  payoutVenmoHandle: string | null;
  paidAt: string | null;
};

export type FollowerRewardState = {
  awarded: boolean;
  reward: FollowerReward | null;
  realBalance: number;
};

export type FollowerRewardNotice = {
  awarded: boolean;
  rewardAmount: number;
  username: string | null;
  realBalance: number;
};

export type AdminPayout = {
  id: string;
  user_id: string;
  username: string;
  display_name: string | null;
  avatar_url: string | null;
  follower_count: number;
  reward_amount: number;
  claimed: boolean;
  created_at: string;
  payout_requested_at: string | null;
  payout_venmo_handle: string | null;
  paid_at: string | null;
  payout_note: string | null;
  real_balance: number;
};

/** `1` -> `"$1.00"`, `12.5` -> `"$12.50"`. Safe on null/garbage. */
export function formatRealMoney(value: number | null | undefined): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? Math.max(0, n) : 0;
  return `$${safe.toFixed(2)}`;
}

/** Cashout needs an unclaimed reward and at least $1.00 of real balance. */
export function canCashOut(balance: number | null | undefined, claimed: boolean): boolean {
  const n = Number(balance);
  return !claimed && Number.isFinite(n) && n >= MIN_REAL_CASHOUT;
}

/**
 * Venmo link for a manual payout. Coolerup pays the creator, so the note names
 * the account being paid and the amount is fixed at the reward.
 */
export function venmoCashoutUrl(handle: string, amount = FOLLOWER_REWARD_AMOUNT): string {
  const recipient = normalizeVenmoHandle(handle) ?? handle.trim().replace(/^@+/, "");
  const params = new URLSearchParams({
    txn: "pay",
    recipients: recipient,
    amount: amount.toFixed(2),
    note: "Coolerup creator fund payout",
  });
  return `https://venmo.com/?${params.toString()}`;
}

/** Fired whenever real balance changes, so every mounted wallet re-reads it. */
export const REAL_BALANCE_EVENT = "loop-real-balance-changed";

export function notifyRealBalanceChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(REAL_BALANCE_EVENT));
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

/** Reads the signed-in user's reward row and real balance. */
export async function myFollowerReward(): Promise<FollowerRewardState> {
  const data = await rpc<Record<string, unknown>>("my_follower_reward");
  if (!data || data["ok"] === false) {
    return { awarded: false, reward: null, realBalance: 0 };
  }
  const awarded = data["awarded"] === true;
  return {
    awarded,
    realBalance: num(data["realBalance"]),
    reward: awarded
      ? {
          rewardId: String(data["rewardId"] ?? ""),
          username: (data["username"] as string | null) ?? null,
          followerCount: num(data["followerCount"], 1),
          rewardAmount: num(data["rewardAmount"], FOLLOWER_REWARD_AMOUNT),
          claimed: data["claimed"] === true,
          createdAt: (data["createdAt"] as string | null) ?? null,
          payoutRequestedAt: (data["payoutRequestedAt"] as string | null) ?? null,
          payoutVenmoHandle: (data["payoutVenmoHandle"] as string | null) ?? null,
          paidAt: (data["paidAt"] as string | null) ?? null,
        }
      : null,
  };
}

/**
 * Claims the one-time celebration. The database flips `notified`, so calling
 * this repeatedly (mount, focus, realtime) still shows the modal only once.
 */
export async function takeFollowerRewardNotice(): Promise<FollowerRewardNotice | null> {
  try {
    const data = await rpc<Record<string, unknown>>("take_follower_reward_notice");
    if (!data || data["ok"] === false || data["awarded"] !== true) return null;
    return {
      awarded: true,
      rewardAmount: num(data["rewardAmount"], FOLLOWER_REWARD_AMOUNT),
      username: (data["username"] as string | null) ?? null,
      realBalance: num(data["realBalance"]),
    };
  } catch {
    // A missing function (migration not applied yet) must never break the app.
    return null;
  }
}

export async function myRealBalance(): Promise<number> {
  try {
    const data = await rpc<unknown>("my_real_balance");
    return num(data);
  } catch {
    return 0;
  }
}

/** Records a manual payout request. Returns an error string on failure. */
export async function requestFollowerPayout(
  venmoHandle: string,
): Promise<{ ok: boolean; error?: string; amount?: number }> {
  const handle = normalizeVenmoHandle(venmoHandle);
  if (!handle) return { ok: false, error: "Enter your Venmo username" };
  try {
    const data = await rpc<Record<string, unknown>>("request_follower_payout", {
      _venmo_handle: handle,
    });
    if (!data || data["ok"] === false) {
      return { ok: false, error: String(data?.["error"] ?? "Couldn't request a payout") };
    }
    return { ok: true, amount: num(data["amount"], FOLLOWER_REWARD_AMOUNT) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't request a payout" };
  }
}

export async function adminFollowerPayouts(limit = 200): Promise<AdminPayout[]> {
  const data = await rpc<AdminPayout[]>("admin_follower_payouts", { _limit: limit });
  return Array.isArray(data) ? data : [];
}

export async function adminMarkPayoutPaid(
  rewardId: string,
  note?: string,
  method = "venmo",
): Promise<{ ok: boolean; error?: string }> {
  try {
    const data = await rpc<Record<string, unknown>>("admin_mark_payout_paid", {
      _reward_id: rewardId,
      _note: note ?? null,
      _method: method,
    });
    if (!data || data["ok"] === false) {
      return { ok: false, error: String(data?.["error"] ?? "Couldn't mark it paid") };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't mark it paid" };
  }
}

export type FollowResult = { ok: boolean; error?: string };

/**
 * Follows a creator. The $1 reward is decided by the database trigger, so there
 * is nothing extra to do here — the followed user's app picks it up in realtime.
 */
export async function followUser(input: {
  followerId: string;
  followerUsername: string;
  followingUsername: string;
}): Promise<FollowResult> {
  const { followerId, followerUsername, followingUsername } = input;
  if (!followerId) return { ok: false, error: "Sign in to follow" };
  if (
    !followingUsername ||
    followerUsername.trim().toLowerCase() === followingUsername.trim().toLowerCase()
  ) {
    return { ok: false, error: "You can't follow yourself" };
  }
  const { error } = await supabase.from("follows").insert({
    follower_id: followerId,
    follower_username: followerUsername,
    following_username: followingUsername,
  });
  // 23505 = already following, which is a success from the user's point of view.
  if (error && error.code !== "23505") return { ok: false, error: error.message };
  return { ok: true };
}

export async function unfollowUser(input: {
  followerId: string;
  followingUsername: string;
}): Promise<FollowResult> {
  const { error } = await supabase
    .from("follows")
    .delete()
    .eq("follower_id", input.followerId)
    .eq("following_username", input.followingUsername);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function isFollowing(followerId: string, followingUsername: string): Promise<boolean> {
  const { data } = await supabase
    .from("follows")
    .select("id")
    .eq("follower_id", followerId)
    .eq("following_username", followingUsername)
    .maybeSingle();
  return !!data;
}

export type RealBalance = {
  balance: number | null;
  loading: boolean;
  refresh: () => Promise<void>;
};

/** Live real-money balance for the wallet page. */
export function useRealBalance(userId?: string | null): RealBalance {
  const [balance, setBalance] = useState<number | null>(null);
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
      return;
    }
    setLoading(true);
    const next = await myRealBalance();
    if (!mounted.current) return;
    setLoading(false);
    setBalance(next);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const onEvent = () => void refresh();
    window.addEventListener(REAL_BALANCE_EVENT, onEvent);
    window.addEventListener("focus", onEvent);
    const channel = supabase
      .channel(`real-balance:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "user_balance", filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      window.removeEventListener(REAL_BALANCE_EVENT, onEvent);
      window.removeEventListener("focus", onEvent);
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { balance, loading, refresh };
}
