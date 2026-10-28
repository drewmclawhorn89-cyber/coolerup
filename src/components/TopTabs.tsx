import { useEffect, useRef } from "react";

export type TopTabId =
  | "following"
  | "foryou"
  | "explore"
  | "marketplace"
  | "live"
  | "groups"
  | "shop"
  | "subscriptions"
  | "mine";

export type TopTab = { id: TopTabId; label: string; live?: boolean };

/** Single source of truth for the top tab row, in display order. */
export const TOP_TABS: TopTab[] = [
  { id: "following", label: "Following" },
  { id: "foryou", label: "For You" },
  { id: "explore", label: "Explore" },
  { id: "marketplace", label: "Marketplace" },
  { id: "live", label: "LIVE", live: true },
  { id: "groups", label: "Groups" },
  { id: "shop", label: "Shop" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "mine", label: "Mine" },
];

/**
 * TikTok-style top tab row.
 *
 * - Edge-to-edge: the row starts flush against the left screen edge (just the
 *   standard 16px gutter) and scrolls off the right edge, instead of being
 *   centred inside the column.
 * - Horizontally scrollable with hidden scrollbars and snap points.
 * - The active tab is auto-centred whenever it changes.
 * - Active tab is bold white with a short underline; the rest are dim.
 */
export function TopTabs({
  active,
  onPick,
  variant = "fixed",
}: {
  active: TopTabId;
  onPick: (id: TopTabId) => void;
  /** "fixed" pins to the top of the viewport, "inline" sits in normal flow. */
  variant?: "fixed" | "inline";
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the selected tab centred when the feed switches.
  useEffect(() => {
    const box = scroller.current;
    const el = box?.querySelector<HTMLElement>('[data-active="true"]');
    if (!box || !el) return;
    const boxRect = box.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    // Already fully visible — leave the row where the user put it.
    if (elRect.left >= boxRect.left && elRect.right <= boxRect.right) return;
    const delta = elRect.left - boxRect.left;
    const target = box.scrollLeft + delta - (box.clientWidth - elRect.width) / 2;
    box.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [active]);

  const row = (
    <div
      ref={scroller}
      className="no-scrollbar flex w-full items-end gap-5 overflow-x-auto overscroll-x-contain bg-gradient-to-b from-black/90 via-black/55 to-transparent px-4 pb-2 pt-3"
    >
      {TOP_TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            data-active={isActive}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onPick(t.id)}
            className={`relative flex shrink-0 items-center gap-1 whitespace-nowrap pb-1.5 text-[15px] leading-none transition-colors ${
              isActive ? "font-bold text-white" : "font-medium text-white/60"
            }`}
          >
            {t.live && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
            {t.label}
            <span
              aria-hidden="true"
              className={`absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-white transition-opacity duration-200 ${
                isActive ? "opacity-100" : "opacity-0"
              }`}
            />
          </button>
        );
      })}
    </div>
  );

  if (variant === "inline") return <div className="w-full bg-black">{row}</div>;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center">
      <div className="pointer-events-auto w-full max-w-[430px]">{row}</div>
    </div>
  );
}

/** Padding that clears the fixed bar, for content underneath it. */
export const TOP_TABS_OFFSET = "pt-[4.75rem]";
