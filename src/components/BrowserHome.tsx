import { ArrowRight, Clock, Sparkles, Star, TrendingUp } from "lucide-react";
import { SHORTCUTS, type BrowserHistoryRow } from "@/lib/coolerupBrowser";

/**
 * The Coolerup Browser home page.
 *
 * Deliberately not a Google homepage clone: it is a Coolerup surface — blue
 * hero, rounded shortcut cards, and the things you actually open in this app.
 */
export function BrowserHome({
  recent,
  onOpenShortcut,
  onOpenUrl,
  onSearch,
}: {
  recent: BrowserHistoryRow[];
  onOpenShortcut: (shortcut: (typeof SHORTCUTS)[number]) => void;
  onOpenUrl: (url: string) => void;
  onSearch: (query: string) => void;
}) {
  const suggestions = ["mgk starman", "funny cat videos", "how to make a gif", "nba scores"];

  return (
    <div className="min-h-[60vh] bg-[#0b1220] px-4 pb-8 pt-5 text-white">
      {/* Hero */}
      <div className="rounded-2xl bg-gradient-to-br from-[#2563EB] to-[#1d4fc4] p-4 shadow-lg shadow-blue-900/30">
        <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-blue-100">
          <Sparkles className="h-3.5 w-3.5" /> Coolerup Browser
        </p>
        <h2 className="mt-1 text-xl font-black leading-tight">
          The whole web,
          <br />
          still inside Coolerup.
        </h2>
        <p className="mt-1.5 text-xs text-blue-100">
          Search, browse and save — your top bar never leaves the app.
        </p>
      </div>

      {/* Shortcuts */}
      <h3 className="mt-5 pb-2 text-xs font-bold uppercase tracking-wider text-white/50">
        Shortcuts
      </h3>
      <div className="grid grid-cols-3 gap-2.5">
        {SHORTCUTS.map((shortcut) => (
          <button
            key={shortcut.id}
            type="button"
            onClick={() => onOpenShortcut(shortcut)}
            className="flex flex-col items-start gap-1 rounded-2xl border border-white/10 bg-white/[0.06] p-3 text-left transition active:scale-[0.97] hover:border-[#2563EB]/60 hover:bg-white/[0.09]"
          >
            <span aria-hidden className="text-xl leading-none">
              {shortcut.emoji}
            </span>
            <span className="mt-1 text-[13px] font-bold leading-tight">{shortcut.label}</span>
            <span className="text-[10px] leading-tight text-white/45">{shortcut.blurb}</span>
          </button>
        ))}
      </div>

      {/* Trending searches */}
      <h3 className="mt-6 flex items-center gap-1.5 pb-2 text-xs font-bold uppercase tracking-wider text-white/50">
        <TrendingUp className="h-3.5 w-3.5" /> Try searching
      </h3>
      <div className="flex flex-wrap gap-2">
        {suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSearch(suggestion)}
            className="rounded-full border border-white/10 bg-white/[0.06] px-3 py-1.5 text-xs font-semibold text-white/80 hover:border-[#2563EB]/60 hover:text-white"
          >
            {suggestion}
          </button>
        ))}
      </div>

      {/* Recent */}
      {recent.length > 0 && (
        <>
          <h3 className="mt-6 flex items-center gap-1.5 pb-2 text-xs font-bold uppercase tracking-wider text-white/50">
            <Clock className="h-3.5 w-3.5" /> Recent
          </h3>
          <ul className="divide-y divide-white/5 overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
            {recent.slice(0, 5).map((row) => (
              <li key={row.id}>
                <button
                  type="button"
                  onClick={() => (row.url ? onOpenUrl(row.url) : row.query && onSearch(row.query))}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left"
                >
                  <Clock className="h-4 w-4 shrink-0 text-white/35" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold">
                      {row.query || row.url}
                    </span>
                    {row.query && row.url && (
                      <span className="block truncate text-[10px] text-white/40">{row.url}</span>
                    )}
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-white/25" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-white/35">
        <Star className="h-3 w-3" /> Tap ⭐ Save to keep a site in Coolerup
      </p>
    </div>
  );
}
