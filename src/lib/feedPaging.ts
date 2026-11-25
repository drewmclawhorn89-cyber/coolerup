/**
 * Shared 10-at-a-time feed paging helpers.
 *
 * Every feed (short form and long form) shows 10 items, then loads 10 more as
 * the viewer reaches the bottom. Short form and long form keep separate
 * counters because they render different lists; these helpers are stateless so
 * each list can own its own window without ever touching the other.
 */

/** Items revealed per batch. */
export const FEED_BATCH_SIZE = 10;

/** How many upcoming videos may be preloaded (never the whole list). */
export const PRELOAD_AHEAD = 2;

export type PreloadMode = "active" | "next" | "idle";

/**
 * Decide what a card at `index` should do relative to the on-screen card.
 * Only the active card plays; the next two may preload; everything else stays
 * idle so off-screen videos never hold a network connection.
 */
export function preloadModeFor(
  index: number,
  activeIndex: number,
  opts: { lite?: boolean; lowData?: boolean } = {},
): PreloadMode {
  if (index === activeIndex) return "active";
  if (opts.lite || opts.lowData) return "idle";
  const ahead = index - activeIndex;
  if (ahead > 0 && ahead <= PRELOAD_AHEAD) return "next";
  return "idle";
}

/**
 * Grow a client-side visible window by one batch, clamped to the total.
 * Used by lists that already hold their rows (e.g. Watch History) so they can
 * reveal 10 at a time instead of dumping everything at once.
 */
export function nextVisibleCount(
  current: number,
  total: number,
  step: number = FEED_BATCH_SIZE,
): number {
  const safeTotal = Math.max(0, total);
  const safeStep = Math.max(1, step);
  return Math.min(safeTotal, Math.max(0, current) + safeStep);
}

/** True while there are still rows hidden past the visible window. */
export function hasMoreToShow(visible: number, total: number): boolean {
  return visible < Math.max(0, total);
}
