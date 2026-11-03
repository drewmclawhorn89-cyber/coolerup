/**
 * The creator fund.
 *
 * Creators are paid per view at fixed milestones. Everything here is a thin
 * reader over the database: the milestone award itself happens inside
 * `check_creator_fund()`, which is idempotent (one row per milestone per
 * account), so calling it from the dashboard, a cron job, or a page load can
 * never pay the same milestone twice.
 *
 * QUALIFICATION
 *   10 followers AND 10,000 views in the last 30 days.
 *
 * MILESTONES (per video, paid once each per video)
 *   1,000     -> $0.02
 *   10,000    -> $0.20
 *   100,000   -> $2.00
 *   1,000,000 -> $20.00
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { notifyWalletChanged } from "@/lib/payouts";

export const QUALIFY_FOLLOWERS = 10;
export const QUALIFY_VIEWS_30D = 10000;

export type Milestone = { views: number; amount: number };

export const CREATOR_FUND_MILESTONES: Milestone[] = [
  { views: 1_000, amount: 0.02 },
  { views: 10_000, amount: 0.2 },
  { views: 100_000, amount: 2 },
  { views: 1_000_000, amount: 20 },
];

export type CreatorFundEarning = {
  id: string;
  videoId: string | null;
  /** Views the video had when the milestone was paid. */
  views: number;
  milestoneViews: number;
  /** Same money as `amount`; kept so both column names read naturally. */
  earnings: number;
  amount: number;
  createdAt: string;
  caption: string | null;
  videoUsername: string | null;
};

export type CreatorFundVideo = {
  videoId: string;
  caption: string | null;
  videoUsername: string | null;
  views: number;
  earnings: number;
};

export type CreatorFund = {
  qualified: boolean;
  followers: number;
  views30d: number;
  totalViews: number;
  earned: number;
  nextMilestone: number | null;
  earnings: CreatorFundEarning[];
  videos: CreatorFundVideo[];
};

const EMPTY: CreatorFund = {
  qualified: false,
  followers: 0,
  views30d: 0,
  totalViews: 0,
  earned: 0,
  nextMilestone: CREATOR_FUND_MILESTONES[0]?.views ?? 1000,
  earnings: [],
  videos: [],
};

const num = (v: unknown, fallback = 0): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v as Record<string, unknown>[]) : [];

async function rpc<T = Record<string, unknown> | null>(
  name: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.rpc(name as never, args as never);
  if (error) throw new Error(error.message);
  return (data ?? null) as T;
}

/** The first milestone a creator has not been paid for yet. */
export function nextMilestoneFor(totalViews: number): number | null {
  const found = CREATOR_FUND_MILESTONES.find((m) => m.views > totalViews);
  return found ? found.views : null;
}

/** Dollars a milestone is worth. Unknown milestones are worth nothing. */
export function milestoneAmount(views: number): number {
  return CREATOR_FUND_MILESTONES.find((m) => m.views === views)?.amount ?? 0;
}

/**
 * 0..1 progress toward the next milestone. Returns 1 when every milestone has
 * been reached.
 */
export function milestoneProgress(totalViews: number): number {
  const next = nextMilestoneFor(totalViews);
  if (next === null) return 1;
  const reached = CREATOR_FUND_MILESTONES.filter((m) => m.views <= totalViews).pop();
  const from = reached ? reached.views : 0;
  if (next <= from) return 1;
  const pct = (totalViews - from) / (next - from);
  return Math.min(1, Math.max(0, pct));
}

/** True when the creator meets both halves of the qualification bar. */
export function isQualified(followers: number, views30d: number): boolean {
  return followers >= QUALIFY_FOLLOWERS && views30d >= QUALIFY_VIEWS_30D;
}

/** `12345` -> `"12.3K"`. Safe on null/garbage. */
export function formatViews(value: number | null | undefined): string {
  const n = Number(value);
  const safe = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  if (safe >= 1_000_000) return `${(safe / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (safe >= 1_000) return `${(safe / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(safe);
}

export async function myCreatorFund(): Promise<CreatorFund> {
  try {
    const data = obj(await rpc<unknown>("my_creator_fund"));
    if (data["ok"] === false) return EMPTY;
    const totalViews = num(data["totalViews"]);
    return {
      qualified: data["qualified"] === true,
      followers: num(data["followers"]),
      views30d: num(data["views30d"]),
      totalViews,
      earned: num(data["earned"]),
      nextMilestone: data["nextMilestone"] === null ? null : num(data["nextMilestone"], 0) || null,
      earnings: list(data["earnings"]).map((row) => ({
        id: String(row["id"] ?? ""),
        videoId: row["video_id"] ? String(row["video_id"]) : null,
        views: num(row["views"]),
        milestoneViews: num(row["milestone_views"]),
        earnings: num(row["earnings"]),
        amount: num(row["amount"]),
        createdAt: String(row["created_at"] ?? ""),
        caption: row["caption"] ? String(row["caption"]) : null,
        videoUsername: row["video_username"] ? String(row["video_username"]) : null,
      })),
      videos: list(data["videos"]).map((row) => ({
        videoId: String(row["video_id"] ?? ""),
        caption: row["caption"] ? String(row["caption"]) : null,
        videoUsername: row["video_username"] ? String(row["video_username"]) : null,
        views: num(row["views"]),
        earnings: num(row["earnings"]),
      })),
    };
  } catch {
    return EMPTY;
  }
}

/**
 * Runs the milestone check. Safe to call on every dashboard load: the database
 * only pays a milestone that has not been paid before.
 */
export async function checkCreatorFund(userId?: string | null): Promise<CreatorFund> {
  try {
    const data = obj(await rpc<unknown>("check_creator_fund", { p_user_id: userId ?? null }));
    const awarded = list(data["awarded"]);
    if (awarded.length > 0) notifyWalletChanged();
  } catch {
    // Not qualified, not signed in, or migration missing: all non-fatal.
  }
  return myCreatorFund();
}

/**
 * Records a view. Anonymous viewers and the creator's own views are rejected by
 * the database, and a signed-in viewer only ever counts once per video.
 */
export async function recordVideoView(videoId: string): Promise<boolean> {
  if (!videoId) return false;
  try {
    const data = obj(await rpc<unknown>("record_video_view", { p_video_id: videoId }));
    return data["counted"] === true;
  } catch {
    return false;
  }
}

export type LiveCreatorFund = CreatorFund & {
  loading: boolean;
  refresh: () => Promise<void>;
};

/** Live creator-fund state for the dashboard. */
export function useCreatorFund(userId?: string | null): LiveCreatorFund {
  const [fund, setFund] = useState<CreatorFund>(EMPTY);
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
      setFund(EMPTY);
      return;
    }
    setLoading(true);
    const next = await myCreatorFund();
    if (!mounted.current) return;
    setLoading(false);
    setFund(next);
  }, [userId]);

  useEffect(() => {
    void refresh();
    if (!userId) return;
    const channel = supabase
      .channel(`creator-fund:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "video_views", filter: `user_id=eq.${userId}` },
        () => void refresh(),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "creator_fund_earnings",
          filter: `user_id=eq.${userId}`,
        },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, refresh]);

  return { ...fund, loading, refresh };
}
