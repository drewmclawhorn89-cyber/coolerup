import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Clock, Globe2, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  clearHistory,
  displayTitle,
  listHistory,
  prettyUrl,
  type BrowserHistoryRow,
} from "@/lib/coolerupBrowser";

export const Route = createFileRoute("/browser/history")({
  head: () => ({
    meta: [
      { title: "History — Coolerup Browser" },
      { name: "description", content: "Everything you searched in Coolerup Browser." },
    ],
  }),
  component: BrowserHistoryPage,
});

function BrowserHistoryPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BrowserHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await listHistory();
    setRows(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onClear = async () => {
    await clearHistory();
    setRows([]);
    toast.success("History cleared");
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
              <Clock className="h-4 w-4" />
            </span>
            History
          </span>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={() => void onClear()}
              className="ml-auto flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/25"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-3 pt-4">
        {loading ? (
          <p className="py-16 text-center text-sm text-white/50">Loading your history…</p>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#111a2e] px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden>
              🕘
            </span>
            <p className="text-sm font-bold">Nothing here yet</p>
            <p className="max-w-xs text-xs text-white/50">
              Searches and sites you open in Coolerup Browser show up here.
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
            {rows.map((row) => {
              const isSearch = !!row.query;
              const href = isSearch ? (row.query ?? "") : (row.url ?? "");
              return (
                <li key={row.id}>
                  {isSearch ? (
                    <Link
                      to="/browser"
                      search={{ q: href }}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111a2e] px-3 py-3 transition hover:border-[#2563EB]/60 hover:bg-[#16223c]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB]/20 text-[#93c5fd]">
                        <Search className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[11px] font-bold uppercase tracking-wide text-white/40">
                          You searched
                        </span>
                        <span className="block truncate text-sm font-semibold text-white">
                          {row.query}
                        </span>
                      </span>
                    </Link>
                  ) : (
                    <Link
                      to="/browser"
                      search={{ url: href }}
                      className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111a2e] px-3 py-3 transition hover:border-[#2563EB]/60 hover:bg-[#16223c]"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2563EB]/20 text-[#93c5fd]">
                        <Globe2 className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-white">
                          {displayTitle(href)}
                        </span>
                        <span className="block truncate text-xs text-white/45">
                          {prettyUrl(href)}
                        </span>
                      </span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
