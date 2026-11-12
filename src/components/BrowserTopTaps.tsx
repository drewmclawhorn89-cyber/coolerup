import { BROWSER_SITES } from "@/lib/browser";

/**
 * The site strip that sits under the search pill, styled exactly like the
 * Music page's inner tabs: a horizontal scroller of underlined labels.
 *
 * Tapping a tab jumps the current browser tab to that site (or runs the
 * current query on it), so it doubles as "search this site".
 */
export function BrowserTopTaps({
  active,
  onPick,
}: {
  active: string;
  onPick: (siteId: string) => void;
}) {
  return (
    <div className="no-scrollbar mx-auto flex max-w-2xl gap-4 overflow-x-auto px-4 pb-2">
      {BROWSER_SITES.map((site) => (
        <button
          key={site.id}
          type="button"
          onClick={() => onPick(site.id)}
          aria-pressed={active === site.id}
          className={`shrink-0 border-b-2 pb-1.5 text-[13px] font-semibold ${
            active === site.id
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground"
          }`}
        >
          <span className="inline-flex items-center gap-1">
            <span aria-hidden className="text-[13px] leading-none">
              {site.emoji}
            </span>
            {site.label}
          </span>
        </button>
      ))}
    </div>
  );
}
