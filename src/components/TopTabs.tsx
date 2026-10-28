import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

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

/**
 * The three tabs TikTok shows in the centred header row.
 * Following is left, For You is centre (default), LIVE is right.
 */
export const PRIMARY_TABS: TopTab[] = [
  { id: "following", label: "Following" },
  { id: "foryou", label: "For You" },
  { id: "live", label: "LIVE", live: true },
];

/**
 * Everything else the app can show. Kept behind the chevron so the header row
 * stays exactly three tabs wide and perfectly centred, like TikTok.
 */
export const MORE_TABS: TopTab[] = [
  { id: "explore", label: "Explore" },
  { id: "marketplace", label: "Marketplace" },
  { id: "groups", label: "Groups" },
  { id: "shop", label: "Shop" },
  { id: "subscriptions", label: "Subscriptions" },
  { id: "mine", label: "Mine" },
];

/** Full list in display order (kept for callers that need every tab). */
export const TOP_TABS: TopTab[] = [...PRIMARY_TABS, ...MORE_TABS];

export function TopTabs({
  active,
  onPick,
  variant = "fixed",
}: {
  active: TopTabId;
  onPick: (id: TopTabId) => void;
  variant?: "fixed" | "inline";
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);

  // Close the overflow menu on outside click or Escape.
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const activeIsMore = MORE_TABS.some((t) => t.id === active);

  const row = (
    <div className="relative grid w-full grid-cols-3 items-end bg-gradient-to-b from-black/60 to-transparent px-4 pb-2 pt-3">
      {PRIMARY_TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            data-active={isActive}
            aria-current={isActive ? "page" : undefined}
            onClick={() => onPick(t.id)}
            className={`flex items-center justify-self-center gap-1 whitespace-nowrap border-b-2 pb-1 text-[16px] leading-none transition-colors ${
              isActive
                ? "border-white font-bold text-white"
                : "border-transparent font-medium text-white/60"
            }`}
          >
            {t.live && <span className="h-2 w-2 shrink-0 rounded-full bg-red-500" />}
            {t.label}
          </button>
        );
      })}

      {/* Overflow: keeps Groups / Marketplace / Shop reachable without widening the row. */}
      <div ref={moreRef} className="absolute right-1 top-1.5">
        <button
          type="button"
          aria-label="More tabs"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen((v) => !v)}
          className={`flex h-7 w-7 items-center justify-center rounded-full transition ${
            activeIsMore ? "text-white" : "text-white/60"
          } hover:text-white`}
        >
          <ChevronDown className="h-5 w-5" />
        </button>
        {moreOpen && (
          <div
            role="menu"
            className="absolute right-0 top-8 z-50 w-44 overflow-hidden rounded-xl border border-[#222] bg-black/95 py-1 text-white shadow-xl backdrop-blur"
          >
            {MORE_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoreOpen(false);
                  onPick(t.id);
                }}
                className={`flex w-full items-center px-3 py-2 text-left text-[14px] transition hover:bg-white/10 ${
                  active === t.id ? "font-bold text-white" : "font-medium text-white/70"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  if (variant === "inline") return <div className="w-full bg-black">{row}</div>;

  return (
    <div className="fixed left-1/2 top-0 z-50 w-full max-w-[430px] -translate-x-1/2">{row}</div>
  );
}

/** Padding that clears the fixed bar, for content underneath it. */
export const TOP_TABS_OFFSET = "pt-[4.75rem]";
