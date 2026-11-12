/**
 * Christmas codes tab — seasonal visibility.
 *
 * The "Codes" top tab only exists during the Coolerup Christmas Update. Unlike
 * `isChristmasMode()` in `@/lib/christmas` (which is pinned to the 2026 launch
 * window), this window repeats every year: it opens on Nov 15 and closes at the
 * end of Jan 1, so the tab turns itself on and off with no deploy, no flag and
 * no database row.
 *
 *   Nov 14  -> hidden
 *   Nov 15  -> visible, with the Christmas code list
 *   Jan 2   -> hidden again
 *   Nov 15 (next year) -> visible again, automatically
 *
 * Keep this file free of React APIs at module scope so it can be imported from
 * anywhere. The hook lives at the bottom.
 */
import { useEffect, useState } from "react";

import { CHRISTMAS_TEST_EVENT, isChristmasTestMode } from "@/lib/christmas-test";

/** Month is 0-indexed, matching `Date#getMonth()`. Nov = 10. */
export const SEASON_START_MONTH = 10;
export const SEASON_START_DAY = 15;
/** The season runs through the end of Jan 1 (Jan = 0). */
export const SEASON_END_MONTH = 0;
export const SEASON_END_DAY = 1;

/**
 * True while the Christmas codes tab should be shown.
 *
 * The season wraps the new year, so "between Nov 15 and Jan 1" is two separate
 * comparisons rather than a single range: from Nov 15 to Dec 31, *or* on Jan 1.
 */
export function isChristmasCodesSeason(now: Date = new Date()): boolean {
  // The owner can force the seasonal tab on from Settings to preview it.
  if (isChristmasTestMode()) return true;
  const month = now.getMonth();
  const day = now.getDate();

  // Nov 15 -> Dec 31
  if (month === SEASON_START_MONTH) return day >= SEASON_START_DAY;
  if (month === 11) return true;
  // Jan 1 only
  if (month === SEASON_END_MONTH) return day <= SEASON_END_DAY;
  return false;
}

/**
 * The season this date belongs to, as a stable `YYYY` key. January dates count
 * toward the previous year's season, so Dec 2026 and Jan 2027 share "2026".
 * Handy for one-time-per-season flags such as "already saw the intro".
 */
export function christmasCodesSeasonKey(now: Date = new Date()): number {
  const year = now.getFullYear();
  return now.getMonth() === SEASON_END_MONTH ? year - 1 : year;
}

/** Whole days left in the current season (0 once it has closed). */
export function daysLeftInSeason(now: Date = new Date()): number {
  const key = christmasCodesSeasonKey(now);
  // Season closes at the very end of Jan 1 following the season year.
  const end = new Date(key + 1, SEASON_END_MONTH, SEASON_END_DAY, 23, 59, 59, 999);
  const ms = end.getTime() - now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / 86_400_000);
}

/** "Christmas 2026" — the label shown above the tab's code list. */
export function christmasCodesSeasonLabel(now: Date = new Date()): string {
  return `Christmas ${christmasCodesSeasonKey(now)}`;
}

/**
 * React binding for `isChristmasCodesSeason()`.
 *
 * Re-checks once a minute and immediately when the tab regains visibility, so
 * an app left open across midnight on Nov 15 (or Jan 2) flips without a reload.
 */
export function useChristmasCodesSeason(): boolean {
  const [on, setOn] = useState<boolean>(() => isChristmasCodesSeason());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setOn(isChristmasCodesSeason());
      timer = setTimeout(tick, 60_000);
    };

    setOn(isChristmasCodesSeason());
    timer = setTimeout(tick, 60_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") setOn(isChristmasCodesSeason());
    };
    document.addEventListener("visibilitychange", onVisible);
    // The owner's test switch flips the tab instantly, without waiting for the
    // next minute tick.
    window.addEventListener(CHRISTMAS_TEST_EVENT, onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(CHRISTMAS_TEST_EVENT, onVisible);
    };
  }, []);

  return on;
}

/* -------------------------------------------------------------------------- */
/*  Codes featured in the tab                                                 */
/* -------------------------------------------------------------------------- */

export type ChristmasCodeHighlight = {
  code: string;
  title: string;
  blurb: string;
  emoji: string;
  /** Matches the `plan` column: basic -> Plus, premium -> VIP. */
  plan: "basic" | "premium";
  months: number;
  /** Cosmetic only — the database is the real source of truth for limits. */
  note: string;
};

/**
 * The codes the tab advertises. These are seeded by
 * `supabase/migrations/20261124000000_bulk_subscription_codes.sql`; anything
 * deleted or deactivated in /admin/codes will simply fail to redeem, and the
 * error the user sees comes straight from the RPC.
 */
export const CHRISTMAS_CODE_HIGHLIGHTS: ChristmasCodeHighlight[] = [
  {
    code: "CHRISTMAS-2026",
    title: "Christmas gift",
    blurb: "One month of Basic, on the house. Our way of saying merry Christmas.",
    emoji: "🎄",
    plan: "basic",
    months: 1,
    note: "1,000 uses",
  },
  {
    code: "XMAS-2026",
    title: "Premium stocking",
    blurb: "One month of Premium — every perk unlocked through the holidays.",
    emoji: "🎁",
    plan: "premium",
    months: 1,
    note: "500 uses",
  },
  {
    code: "HOLIDAY-2026",
    title: "Holiday bundle",
    blurb: "Three months of Premium to carry you past New Year.",
    emoji: "❄️",
    plan: "premium",
    months: 3,
    note: "200 uses",
  },
  {
    code: "NEWYEAR-2027",
    title: "New Year drop",
    blurb: "Start the year with a month of Premium. Resolutions optional.",
    emoji: "🎆",
    plan: "premium",
    months: 1,
    note: "1,000 uses",
  },
  {
    code: "COOLERUP-FREE",
    title: "Coolerup Free",
    blurb: "The classic. A month of Premium, any time of year.",
    emoji: "👑",
    plan: "premium",
    months: 1,
    note: "100 uses",
  },
  {
    code: "WELCOME",
    title: "New here?",
    blurb: "A month of Basic for anyone who just joined Coolerup.",
    emoji: "⭐",
    plan: "basic",
    months: 1,
    note: "1,000 uses",
  },
];
