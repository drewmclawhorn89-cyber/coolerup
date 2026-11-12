import { Clock, Flame, Search, Trash2, X } from "lucide-react";
import { SearchAvatar } from "@/components/SearchAvatar";
import { TRENDING_SEARCHES, type SearchUser } from "@/lib/search";

type Props = {
  recent: string[];
  suggestions: SearchUser[];
  onPick: (term: string) => void;
  onDeleteRecent: (term: string) => void;
  onClearRecent: () => void;
};

/**
 * What the search page shows before anyone types: trending searches in a
 * horizontal scroller, "You may like" people, and recent searches with a
 * per-row delete.
 */
export function TrendingSearches({
  recent,
  suggestions,
  onPick,
  onDeleteRecent,
  onClearRecent,
}: Props) {
  return (
    <div className="space-y-7 px-4 pb-28 pt-2" data-testid="search-suggestions">
      <section>
        <h2 className="mb-3 flex items-center gap-1.5 text-[15px] font-bold text-white">
          <Flame className="h-4 w-4 text-[#fe2c55]" aria-hidden /> Trending
        </h2>
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
          {TRENDING_SEARCHES.map((term, index) => (
            <button
              key={term}
              type="button"
              onClick={() => onPick(term)}
              className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#2a2a2a] px-3.5 py-2 text-[13px] font-semibold text-white/90 transition hover:bg-[#3a3a3a] active:scale-95"
            >
              <span aria-hidden>{index < 3 ? "🔥" : "🔍"}</span>
              {term}
            </button>
          ))}
        </div>
      </section>

      {recent.length > 0 && (
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-[15px] font-bold text-white">
              <Clock className="h-4 w-4 text-white/50" aria-hidden /> Recent
            </h2>
            <button
              type="button"
              onClick={onClearRecent}
              className="flex items-center gap-1 text-xs font-semibold text-white/45 transition hover:text-white/80"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear all
            </button>
          </div>
          <ul className="divide-y divide-white/5">
            {recent.map((term) => (
              <li key={term} className="flex items-center gap-3 py-2.5">
                <button
                  type="button"
                  onClick={() => onPick(term)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Search className="h-4 w-4 shrink-0 text-white/35" aria-hidden />
                  <span className="truncate text-[14px] text-white/85">{term}</span>
                </button>
                <button
                  type="button"
                  onClick={() => onDeleteRecent(term)}
                  aria-label={`Remove ${term} from recent searches`}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white/35 transition hover:bg-white/10 hover:text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggestions.length > 0 && (
        <section>
          <h2 className="mb-3 text-[15px] font-bold text-white">You may like</h2>
          <div className="no-scrollbar -mx-4 flex gap-4 overflow-x-auto px-4">
            {suggestions.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => onPick(`@${user.handle}`)}
                className="flex w-20 shrink-0 flex-col items-center gap-2 text-center"
              >
                <SearchAvatar name={user.handle} avatarUrl={user.avatar_url} size={64} />
                <span className="w-full truncate text-[12px] font-semibold text-white/85">
                  @{user.handle}
                </span>
                <span className="w-full truncate text-[11px] text-white/40">
                  {user.display_name || "Creator"}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
