/**
 * Coolerup GTA 6 update — a one-time, limited-time event.
 *
 * The window is Nov 8 2026 00:00 through Nov 15 2026 23:59:59 local time. Unlike
 * the Christmas update, this one **never comes back**: once the clock passes the
 * end it is off forever, there is no flag to flip, and the `?gta=test` preview
 * parameter stops working (see `gta6TestAllowed`).
 *
 *   Nov 7  -> off
 *   Nov 8  -> neon sunset theme, banner, countdown, filter, sound, gift, challenge
 *   Nov 15 -> still on through 23:59:59
 *   Nov 16 -> off forever. "GTA 6 Event Ended". Only the OG badge survives.
 *
 * Colours are deliberately *not* the real GTA VI branding — neon pink #FF2E88,
 * purple, palm trees and a sunset gradient, all built from Coolerup's palette.
 *
 * Keep this file free of React APIs at module scope so it can be imported from
 * anywhere (components, tests, scripts). The hooks live at the bottom.
 */
import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";

/** First moment the event is live. */
export const GTA6_START_ISO = "2026-11-08T00:00:00";
/** Last moment the event is live. */
export const GTA6_END_ISO = "2026-11-15T23:59:59";

export const GTA6_START = new Date(GTA6_START_ISO);
export const GTA6_END = new Date(GTA6_END_ISO);

/** Coolerup's own neon palette — inspired by, not copied from, Vice City. */
export const GTA6_PINK = "#FF2E88";
export const GTA6_PURPLE = "#7C3AED";
export const GTA6_ORANGE = "#FF8A3D";

/** The challenge hashtag users must include to enter. */
export const GTA6_HASHTAG = "#GTA6Coolerup";

/** What the top 10 videos win. */
export const GTA6_PRIZE = "1 month of Pro free";

/** How many videos win. */
export const GTA6_WINNERS = 10;

/** The exclusive, never-again profile badge. */
export const GTA6_BADGE = {
  id: "gta6-og",
  label: "GTA 6 OG",
  emoji: "👑",
  /** Shown on the profile tooltip. */
  blurb: "Posted during the Coolerup GTA 6 update — Nov 8-15 2026.",
} as const;

/**
 * The single source of truth for the GTA 6 event.
 *
 * Dates are local-time `new Date("YYYY-MM-DDTHH:mm:ss")` strings (not UTC) so the
 * event flips at midnight where the user actually is.
 */
export function isGTA6Mode(now: Date = new Date()): boolean {
  return now >= GTA6_START && now <= GTA6_END;
}

/**
 * True once the event has finished for good. This is a one-way door: after
 * Nov 15 2026 23:59:59 it stays true forever, which is what hides the banner,
 * filter, gift and challenge and shows the "GTA 6 Event Ended" state.
 */
export function isGTA6Ended(now: Date = new Date()): boolean {
  return now > GTA6_END;
}

/** True before the event opens (Nov 1-7 2026). */
export function isGTA6Upcoming(now: Date = new Date()): boolean {
  return now < GTA6_START;
}

/**
 * Whether the `?gta=test` preview parameter may force the event on.
 *
 * It only works *before* the event ends. After Nov 15 2026 the parameter is
 * ignored, and the app strips it from the URL, so there is no way to bring the
 * event back.
 */
export function gta6TestAllowed(now: Date = new Date()): boolean {
  return !isGTA6Ended(now);
}

export type GTA6TimeLeft = {
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  /** Total milliseconds remaining, clamped at 0. */
  ms: number;
  ended: boolean;
};

/** Split the time remaining until the event closes. */
export function gta6TimeLeft(now: Date = new Date()): GTA6TimeLeft {
  const ms = Math.max(0, GTA6_END.getTime() - now.getTime());
  return {
    days: Math.floor(ms / 86_400_000),
    hours: Math.floor((ms % 86_400_000) / 3_600_000),
    minutes: Math.floor((ms % 3_600_000) / 60_000),
    seconds: Math.floor((ms % 60_000) / 1000),
    ms,
    ended: ms <= 0,
  };
}

/**
 * "6 days 12h 30m left" — the banner copy. Drops the days segment once the
 * countdown is under a day so it reads naturally at the wire.
 */
export function formatGTA6Countdown(now: Date = new Date()): string {
  const t = gta6TimeLeft(now);
  if (t.ended) return "Event ended";
  if (t.days > 0)
    return `${t.days} ${t.days === 1 ? "day" : "days"} ${t.hours}h ${t.minutes}m left`;
  if (t.hours > 0) return `${t.hours}h ${t.minutes}m ${t.seconds}s left`;
  return `${t.minutes}m ${t.seconds}s left`;
}

/** "Nov 8 – Nov 15 2026" — the dates shown under the banner headline. */
export const GTA6_DATE_LABEL = "Nov 8 – Nov 15 2026";

/* -------------------------------------------------------------------------- */
/*  Preview parameter                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Read `?gta=test` from the current URL.
 *
 * Returns true only while the event has not ended, so the parameter is inert
 * after Nov 15 2026.
 */
export function hasGTA6TestParam(search?: string): boolean {
  if (typeof window === "undefined") return false;
  if (!gta6TestAllowed()) return false;
  try {
    return new URLSearchParams(search ?? window.location.search).get("gta") === "test";
  } catch {
    return false;
  }
}

/**
 * Whether the event should be *shown* right now: the real date window, or an
 * owner preview via `?gta=test` before the event has ended.
 *
 * This is what every component and hook uses. `isGTA6Mode()` stays a pure date
 * check so it can be unit tested without a browser.
 */
export function isGTA6Live(now: Date = new Date()): boolean {
  return isGTA6Mode(now) || (gta6TestAllowed(now) && hasGTA6TestParam());
}

/**
 * Strip `?gta=test` from the address bar once the event is over, so a bookmarked
 * preview link can never resurrect the event. Safe to call on every render.
 */
export function stripGTA6TestParam(): void {
  if (typeof window === "undefined") return;
  if (!isGTA6Ended()) return;
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("gta")) return;
    url.searchParams.delete("gta");
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
  } catch {
    /* ignore */
  }
}

/* -------------------------------------------------------------------------- */
/*  OG badge                                                                  */
/* -------------------------------------------------------------------------- */

const BADGE_CACHE_KEY = "gta6-og-badges";
/** Fired when this device learns it earned the badge, so the profile refreshes. */
export const GTA6_BADGE_EVENT = "gta6-badge-change";

/** Handles this device knows hold the OG badge (a cache for offline/first paint). */
function readBadgeCache(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(BADGE_CACHE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    return new Set(
      Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [],
    );
  } catch {
    return new Set();
  }
}

function writeBadgeCache(handles: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(BADGE_CACHE_KEY, JSON.stringify([...handles]));
  } catch {
    /* ignore */
  }
}

/** Cached answer for "does this handle have the OG badge?" */
export function hasGTA6BadgeCached(handle: string | null | undefined): boolean {
  const h = (handle ?? "").replace(/^@/, "").toLowerCase();
  if (!h) return false;
  return readBadgeCache().has(h);
}

/**
 * Award the OG badge to the signed-in user.
 *
 * The database function re-checks the event window server-side, so this can be
 * called freely from the client: after Nov 15 2026 it simply returns false and
 * no badge is ever created again. Returns true when the badge is (or already
 * was) held.
 */
export async function awardGTA6Badge(handle: string | null | undefined): Promise<boolean> {
  const h = (handle ?? "").replace(/^@/, "").toLowerCase();
  if (!h) return false;
  try {
    const { data, error } = await supabase.rpc("award_gta6_badge");
    if (error) return hasGTA6BadgeCached(h);
    if (data === true) {
      const cache = readBadgeCache();
      cache.add(h);
      writeBadgeCache(cache);
      window.dispatchEvent(new Event(GTA6_BADGE_EVENT));
      return true;
    }
    return false;
  } catch {
    return hasGTA6BadgeCached(h);
  }
}

/**
 * Fetch which of the given handles hold the OG badge, for profile display.
 * Falls back to the local cache when offline.
 */
export async function fetchGTA6Badges(handles: string[]): Promise<Set<string>> {
  const clean = handles.map((h) => h.replace(/^@/, "").toLowerCase()).filter(Boolean);
  if (clean.length === 0) return new Set();
  try {
    const { data, error } = await supabase.from("gta6_badges").select("handle").in("handle", clean);
    if (error) throw error;
    const found = new Set(
      (data ?? [])
        .map((row) => (row as { handle?: string }).handle)
        .filter((v): v is string => typeof v === "string"),
    );
    // Merge into the cache so offline profiles still show it.
    const cache = readBadgeCache();
    found.forEach((h) => cache.add(h));
    writeBadgeCache(cache);
    return found;
  } catch {
    return new Set(clean.filter((h) => hasGTA6BadgeCached(h)));
  }
}

/* -------------------------------------------------------------------------- */
/*  Hooks                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * React binding for `isGTA6Mode()`.
 *
 * Re-checks once a minute and immediately when the tab becomes visible, so an
 * app left open across midnight on Nov 8 (or Nov 16) flips without a reload.
 */
export function useGTA6Mode(): boolean {
  const [on, setOn] = useState<boolean>(() => isGTA6Live());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setOn(isGTA6Live());
      timer = setTimeout(tick, 60_000);
    };

    setOn(isGTA6Live());
    timer = setTimeout(tick, 60_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") setOn(isGTA6Live());
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return on;
}

/** React binding for `isGTA6Ended()`. */
export function useGTA6Ended(): boolean {
  const [ended, setEnded] = useState<boolean>(() => isGTA6Ended());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setEnded(isGTA6Ended());
      timer = setTimeout(tick, 60_000);
    };

    setEnded(isGTA6Ended());
    timer = setTimeout(tick, 60_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") setEnded(isGTA6Ended());
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return ended;
}
