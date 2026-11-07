/**
 * Coolerup Christmas update.
 *
 * Everything Christmas is gated behind `isChristmasMode()`, which is a plain
 * date check — no flag, no database row, no admin toggle. The window is
 * Nov 15 2026 00:00 through Jan 1 2027 23:59:59 local time, so the update turns
 * itself on and off on its own:
 *
 *   Nov 1  -> off (normal coolerup.)
 *   Nov 15 -> Santa hat, snow, lights, Christmas camera filters, gifts, sounds
 *   Jan 1  -> off again, back to normal coolerup.
 *
 * Keep this file free of React APIs at module scope so it can be imported from
 * anywhere (components, tests, scripts). The hook lives at the bottom.
 */
import { useEffect, useState } from "react";

/** First moment the update is live. */
export const CHRISTMAS_START_ISO = "2026-11-15T00:00:00";
/** Last moment the update is live. */
export const CHRISTMAS_END_ISO = "2027-01-01T23:59:59";

export const CHRISTMAS_START = new Date(CHRISTMAS_START_ISO);
export const CHRISTMAS_END = new Date(CHRISTMAS_END_ISO);

/**
 * The single source of truth for the Christmas update.
 *
 * Dates are intentionally local-time `new Date("YYYY-MM-DDTHH:mm:ss")` strings
 * (not UTC) so the update flips at midnight where the user actually is.
 */
export const isChristmasMode = () => {
  const now = new Date();
  const start = new Date("2026-11-15T00:00:00");
  const end = new Date("2027-01-01T23:59:59");
  return now >= start && now <= end;
};

/**
 * True while the pre-launch countdown banner should be visible: any time before
 * the update opens, and never after Jan 1 2027. The countdown itself hides on
 * Nov 15, so this is really just "are we still waiting?".
 */
export function isChristmasCountdownVisible(now: Date = new Date()): boolean {
  return now < CHRISTMAS_START && now <= new Date("2027-01-01T23:59:59");
}

/** Whole days until the update starts (0 once it's live). Handy for banners. */
export function daysUntilChristmas(from: Date = new Date()): number {
  if (from >= CHRISTMAS_START) return 0;
  const ms = CHRISTMAS_START.getTime() - from.getTime();
  return Math.ceil(ms / 86_400_000);
}

/**
 * React binding for `isChristmasMode()`.
 *
 * Re-checks at most once a minute and immediately when the tab becomes visible
 * again, so an app left open overnight flips on Nov 15 and off on Jan 1 without
 * a reload.
 */
export function useChristmasMode(): boolean {
  const [on, setOn] = useState<boolean>(() => isChristmasMode());

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = () => {
      if (cancelled) return;
      setOn(isChristmasMode());
      timer = setTimeout(tick, 60_000);
    };

    setOn(isChristmasMode());
    timer = setTimeout(tick, 60_000);

    const onVisible = () => {
      if (document.visibilityState === "visible") setOn(isChristmasMode());
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

/** Virtual gifts for the 🎁 button next to Share. Free to send, just for fun. */
export type ChristmasGift = {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
};

export const CHRISTMAS_GIFTS: ChristmasGift[] = [
  { id: "gift-box", name: "Gift box", emoji: "🎁", blurb: "The classic. Wrapped and ready." },
  { id: "candy-cane", name: "Candy cane", emoji: "🍬", blurb: "Sweet, striped, slightly sticky." },
  { id: "hot-cocoa", name: "Hot cocoa", emoji: "☕", blurb: "Marshmallows included." },
  { id: "snow-globe", name: "Snow globe", emoji: "🔮", blurb: "Shake it for instant snow." },
  {
    id: "christmas-tree",
    name: "Christmas tree",
    emoji: "🎄",
    blurb: "Lights not included. Or are they?",
  },
  { id: "snowman", name: "Snowman", emoji: "⛄", blurb: "He'll melt for you." },
  { id: "star", name: "Star", emoji: "⭐", blurb: "Put it on top of their tree." },
  {
    id: "sleigh",
    name: "Sleigh ride",
    emoji: "🛷",
    blurb: "One ride, no reindeer licence needed.",
  },
];

export function getChristmasGift(id: string): ChristmasGift | null {
  return CHRISTMAS_GIFTS.find((g) => g.id === id) ?? null;
}

/**
 * The 10 Christmas sounds seeded into `public.sounds` by
 * `supabase/migrations/20261103000000_christmas_sounds.sql`.
 *
 * All ten are public-domain carols, synthesised into short loops by
 * `scripts/generate-christmas-sounds.py` and served from
 * `/sounds/christmas/*.mp3`. Nothing here is a commercial recording, so
 * "Use this sound" stays copyright-safe like the rest of the sound library.
 */
export type ChristmasSoundSeed = {
  /** File name (without extension) under public/sounds/christmas. */
  slug: string;
  title: string;
  creator: string;
};

export const CHRISTMAS_SOUND_CREATOR = "coolerup";

export const CHRISTMAS_SOUNDS: ChristmasSoundSeed[] = [
  { slug: "jingle-bells", title: "Christmas - Jingle Bells", creator: CHRISTMAS_SOUND_CREATOR },
  {
    slug: "we-wish-you-a-merry-christmas",
    title: "Christmas - We Wish You a Merry Christmas",
    creator: CHRISTMAS_SOUND_CREATOR,
  },
  { slug: "deck-the-halls", title: "Christmas - Deck the Halls", creator: CHRISTMAS_SOUND_CREATOR },
  { slug: "silent-night", title: "Christmas - Silent Night", creator: CHRISTMAS_SOUND_CREATOR },
  {
    slug: "o-christmas-tree",
    title: "Christmas - O Christmas Tree",
    creator: CHRISTMAS_SOUND_CREATOR,
  },
  {
    slug: "joy-to-the-world",
    title: "Christmas - Joy to the World",
    creator: CHRISTMAS_SOUND_CREATOR,
  },
  { slug: "the-first-noel", title: "Christmas - The First Noel", creator: CHRISTMAS_SOUND_CREATOR },
  {
    slug: "away-in-a-manger",
    title: "Christmas - Away in a Manger",
    creator: CHRISTMAS_SOUND_CREATOR,
  },
  {
    slug: "hark-the-herald-angels-sing",
    title: "Christmas - Hark! The Herald Angels Sing",
    creator: CHRISTMAS_SOUND_CREATOR,
  },
  {
    slug: "o-come-all-ye-faithful",
    title: "Christmas - O Come, All Ye Faithful",
    creator: CHRISTMAS_SOUND_CREATOR,
  },
];

/** Public URL for a seeded Christmas sound. */
export function christmasSoundUrl(slug: string): string {
  return `/sounds/christmas/${slug}.mp3`;
}
