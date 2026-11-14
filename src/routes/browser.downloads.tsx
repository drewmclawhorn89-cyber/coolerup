import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Download, Globe2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  clearDownloads,
  displayTitle,
  listDownloads,
  prettyUrl,
  removeDownload,
  type BrowserDownloadRow,
} from "@/lib/coolerupBrowser";
import { ABOUT_LINE } from "@/lib/browserEngine";

export const Route = createFileRoute("/browser/downloads")({
  head: () => ({
    meta: [
      { title: "Downloads — Coolerup Browser" },
      { name: "description", content: "Images you kept in Coolerup Browser." },
    ],
  }),
  component: BrowserDownloadsPage,
});

function BrowserDownloadsPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<BrowserDownloadRow[]>([]);

  const load = useCallback(() => {
    setRows(listDownloads());
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRemove = (id: string) => {
    removeDownload(id);
    load();
    toast.success("Removed from Coolerup downloads");
  };

  const onClear = () => {
    clearDownloads();
    setRows([]);
    toast.success("Downloads cleared");
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
              <Download className="h-4 w-4" />
            </span>
            Downloads
          </span>
          {rows.length > 0 && (
            <button
              type="button"
              onClick={onClear}
              className="ml-auto flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-white/25"
            >
              <Trash2 className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-3 pt-4">
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-white/10 bg-[#111a2e] px-6 py-16 text-center">
            <span className="text-4xl" aria-hidden>
              📥
            </span>
            <p className="text-sm font-bold">No downloads yet</p>
            <p className="max-w-xs text-xs text-white/50">
              Tap the download button on an image in Coolerup Browser to keep it here. Files stay in
              Coolerup, not in Chrome.
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
                  onClick={() => onRemove(row.id)}
                  aria-label="Remove download"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/40 hover:bg-white/10 hover:text-white"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-6 text-center text-[11px] text-white/35">{ABOUT_LINE}</p>
      </div>
    </div>
  );
}
