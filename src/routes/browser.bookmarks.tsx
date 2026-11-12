import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Bookmark, Globe2, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  displayTitle,
  listBookmarks,
  prettyUrl,
  removeBookmark,
  type BrowserBookmarkRow,
} from "@/lib/coolerupBrowser";

export const Route = createFileRoute("/browser/bookmarks")({
  head: () => ({
    meta: [
      { title: "Bookmarks — Coolerup Browser" },
      { name: "description", content: "Sites you saved in Coolerup Browser." },
    ],
  }),
  component: BrowserBookmarksPage,
});

function BrowserBookmarksPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BrowserBookmarkRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await listBookmarks();
    setRows(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRemove = async (id: string) => {
    await removeBookmark(id);
    setRows((prev) => prev.filter((row) => row.id !== id));
    toast.success("Removed from Coolerup");
  };

  return (
    <div className="min-h-dvh bg-[#0b1220] pb-24 text-white">
      <div className="sticky top-0 z-30 border-b border-black/20 bg-[#2563EB] shadow-lg shadow-blue-950/30">
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 pb-2.5 pt-[max(0.6rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => void navigate({ to: "/browser" })}
            aria-label="Back to Coolerup Browser"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="flex items-center gap-1.5 text-[15px] font-black tracking-tight">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white text-[#2563EB]">
              <Bookmark className="h-4 w-4" />
            </span>
            Bookmarks
          </span>
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-3 pt-4">
        {loading ? (
          <p className="py-16 text-center text-sm text-white/50">Loading your bookmarks…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#111a2e] px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden>
              ⭐
            </span>
            <p className="text-sm font-bold">No saved sites yet</p>
            <p className="max-w-xs text-xs text-white/50">
              Tap <span className="font-bold text-white/70">Save to Coolerup</span> on any page to
              keep it here.
            </p>
            <Link
              to="/browser"
              className="mt-1 rounded-full bg-[#2563EB] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#1d4fc4]"
            >
              Start browsing
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111a2e] px-3 py-3"
              >
                <Link
                  to="/browser"
                  search={{ url: row.url }}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB]/20 text-[#93c5fd]">
                    <Globe2 className="h-4 w-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-white">
                      {row.title || displayTitle(row.url)}
                    </span>
                    <span className="block truncate text-xs text-white/45">
                      {prettyUrl(row.url)}
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  onClick={() => void onRemove(row.id)}
                  aria-label="Remove bookmark"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {rows.length > 0 && (
          <p className="mt-6 flex items-center justify-center gap-1 text-[11px] text-white/35">
            <Star className="h-3 w-3" /> Saved to Coolerup
          </p>
        )}
      </div>
    </div>
  );
}
