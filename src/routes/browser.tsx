import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Bookmark, Clock, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { BrowserTopTaps } from "@/components/BrowserTopTaps";
import { BrowserView, type BrowserTabState } from "@/components/BrowserView";
import {
  BROWSER_SITES,
  addBookmark,
  clearHistory,
  displayTitle,
  isBlockedUrl,
  listBookmarks,
  listHistory,
  parseInput,
  removeBookmark,
  saveHistory,
  siteById,
  urlForSite,
  youtubeIdFromBrowserUrl,
  type BrowserBookmarkRow,
  type BrowserHistoryRow,
} from "@/lib/browser";
import { addYouTubeSong } from "@/lib/youtubeSongs";

export const Route = createFileRoute("/browser")({
  component: BrowserPage,
});

const currentUrlOf = (tab: BrowserTabState | undefined): string | null =>
  tab ? (tab.stack[tab.index] ?? null) : null;

type Panel = "none" | "history" | "bookmarks";

let tabSeq = 0;
const nextTabId = () => `tab-${++tabSeq}`;

function makeTab(url?: string): BrowserTabState {
  if (!url) return { id: nextTabId(), stack: [], index: -1, title: "New tab" };
  return { id: nextTabId(), stack: [url], index: 0, title: displayTitle(url) };
}

/** Which site tab the current URL belongs to, for the active underline. */
function siteForUrl(url: string | null): string {
  if (!url) return "google";
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    const match = BROWSER_SITES.find((site) => {
      try {
        const home = new URL(site.home).hostname.toLowerCase().replace(/^www\./, "");
        return host === home || host.endsWith(`.${home}`);
      } catch {
        return false;
      }
    });
    return match?.id ?? "google";
  } catch {
    return "google";
  }
}

function BrowserPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const addSong = useServerFn(addYouTubeSong);

  const [tabs, setTabs] = useState<BrowserTabState[]>(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]!.id);
  const [address, setAddress] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [panel, setPanel] = useState<Panel>("none");
  const [history, setHistory] = useState<BrowserHistoryRow[]>([]);
  const [bookmarks, setBookmarks] = useState<BrowserBookmarkRow[]>([]);
  const [musicUrl, setMusicUrl] = useState("");
  const [addingSong, setAddingSong] = useState(false);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const currentUrl = currentUrlOf(activeTab);
  const activeSite = useMemo(() => siteForUrl(currentUrl), [currentUrl]);
  const canGoBack = !!activeTab && activeTab.index > 0;
  const canGoForward = !!activeTab && activeTab.index < activeTab.stack.length - 1;
  const saved = useMemo(
    () => !!currentUrl && bookmarks.some((b) => b.url === currentUrl),
    [bookmarks, currentUrl],
  );

  /* Keep the address pill in step with navigation, but not with typing. */
  useEffect(() => {
    setAddress(currentUrl ?? "");
  }, [currentUrl]);

  const refreshPanels = useCallback(async () => {
    const [h, b] = await Promise.all([listHistory(), listBookmarks()]);
    setHistory(h);
    setBookmarks(b);
  }, []);

  useEffect(() => {
    void refreshPanels();
  }, [refreshPanels]);

  /** Push a URL onto the active tab's stack and record it in history. */
  const openUrl = useCallback(
    (url: string, opts: { query?: string; record?: boolean } = {}) => {
      if (isBlockedUrl(url)) {
        toast.error("That site is blocked.");
        return;
      }
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeTabId) return tab;
          const stack = [...tab.stack.slice(0, tab.index + 1), url];
          return { ...tab, stack, index: stack.length - 1, title: displayTitle(url) };
        }),
      );
      setPanel("none");
      if (opts.record !== false) {
        const entry = opts.query ? { query: opts.query, url } : { url };
        void saveHistory(entry).then(refreshPanels);
      }
    },
    [activeTabId, refreshPanels],
  );

  const submitAddress = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseInput(address);
    if (parsed.kind === "empty") return;
    if (parsed.kind === "url") openUrl(parsed.url);
    else openUrl(parsed.url, { query: parsed.query });
  };

  const pickSite = (siteId: string) => {
    const site = siteById(siteId);
    if (!site) return;
    const parsed = parseInput(address);
    const query = parsed.kind === "search" ? parsed.query : "";
    openUrl(urlForSite(site, query), query ? { query } : {});
  };

  const goBack = () =>
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId && tab.index > 0 ? { ...tab, index: tab.index - 1 } : tab,
      ),
    );
  const goForward = () =>
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeTabId && tab.index < tab.stack.length - 1
          ? { ...tab, index: tab.index + 1 }
          : tab,
      ),
    );

  const newTab = () => {
    const tab = makeTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
    setAddress("");
    setPanel("none");
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      if (prev.length === 1) return [makeTab()];
      const next = prev.filter((tab) => tab.id !== id);
      if (id === activeTabId) setActiveTabId(next[next.length - 1]!.id);
      return next;
    });
  };

  const saveCurrent = async () => {
    if (!currentUrl) return;
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    const ok = await addBookmark(currentUrl, displayTitle(currentUrl));
    if (ok) {
      toast.success("Saved to bookmarks");
      await refreshPanels();
    } else {
      toast.error("Could not save that bookmark.");
    }
  };

  const removeSaved = async (id: string) => {
    await removeBookmark(id);
    await refreshPanels();
  };

  const openExternal = (url: string) => {
    if (isBlockedUrl(url)) {
      toast.error("That link is blocked.");
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const addToMusic = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    const url = musicUrl.trim() || currentUrl || "";
    if (!youtubeIdFromBrowserUrl(url)) {
      toast.error("Paste a YouTube song link first.");
      return;
    }
    setAddingSong(true);
    try {
      const song = await addSong({ data: { url } });
      toast.success(`Added “${song.title}” to Music`);
      setMusicUrl("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not add that song.");
    } finally {
      setAddingSong(false);
    }
  };

  const showMusicBar =
    activeSite === "youtube" || (!!currentUrl && !!youtubeIdFromBrowserUrl(currentUrl));

  return (
    <div className="min-h-dvh bg-background pb-32">
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
        {/* Title row */}
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => void navigate({ to: "/" })}
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="flex items-center gap-1.5 text-lg font-black tracking-tight">
            <span aria-hidden>🌐</span> Browser
          </h1>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "history" ? "none" : "history"))}
              aria-label="History"
              className={`flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 ${
                panel === "history" ? "text-primary" : ""
              }`}
            >
              <Clock className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => setPanel((p) => (p === "bookmarks" ? "none" : "bookmarks"))}
              aria-label="Bookmarks"
              className={`flex h-9 w-9 items-center justify-center rounded-full hover:bg-white/10 ${
                panel === "bookmarks" ? "text-primary" : ""
              }`}
            >
              <Bookmark className="h-4.5 w-4.5" />
            </button>
          </div>
        </div>

        {/* Google-style search pill */}
        <div className="mx-auto max-w-2xl px-4 pb-2">
          <form
            onSubmit={submitAddress}
            className="flex items-center gap-2 rounded-full bg-white px-3 shadow-sm"
          >
            <Search className="h-4 w-4 shrink-0 text-neutral-500" />
            <GoogleLogo />
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Search Google or type URL"
              aria-label="Search Google or type a URL"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              className="h-11 w-full min-w-0 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-500"
            />
            {address && (
              <button
                type="button"
                onClick={() => setAddress("")}
                aria-label="Clear"
                className="shrink-0"
              >
                <X className="h-4 w-4 text-neutral-500" />
              </button>
            )}
          </form>
        </div>

        <BrowserTopTaps active={activeSite} onPick={pickSite} />
      </div>

      {/* Add to Music (YouTube only) */}
      {showMusicBar && (
        <form onSubmit={addToMusic} className="mx-auto mt-3 flex max-w-2xl items-center gap-2 px-4">
          <input
            value={musicUrl}
            onChange={(event) => setMusicUrl(event.target.value)}
            placeholder="Paste a YouTube song link…"
            aria-label="Paste a YouTube song link"
            className="h-9 min-w-0 flex-1 rounded-full bg-white/5 px-3 text-xs outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            disabled={addingSong}
            className="flex shrink-0 items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500 disabled:opacity-60"
          >
            {addingSong ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            Add to Music
          </button>
        </form>
      )}

      {panel === "history" ? (
        <HistoryPanel
          rows={history}
          onOpen={(url) => openUrl(url)}
          onClear={async () => {
            await clearHistory();
            await refreshPanels();
          }}
        />
      ) : panel === "bookmarks" ? (
        <BookmarksPanel rows={bookmarks} onOpen={(url) => openUrl(url)} onRemove={removeSaved} />
      ) : (
        <div className="mt-3">
          <BrowserView
            tabs={tabs}
            activeTabId={activeTabId}
            currentUrl={currentUrl}
            canGoBack={canGoBack}
            canGoForward={canGoForward}
            saved={saved}
            reloadKey={reloadKey}
            onBack={goBack}
            onForward={goForward}
            onRefresh={() => setReloadKey((k) => k + 1)}
            onHome={() => openUrl(urlForSite(siteById(activeSite) ?? BROWSER_SITES[0]!))}
            onSave={() => void saveCurrent()}
            onNewTab={newTab}
            onSelectTab={(id) => {
              setActiveTabId(id);
              setPanel("none");
            }}
            onCloseTab={closeTab}
            onOpenExternal={openExternal}
          />
        </div>
      )}
    </div>
  );
}

/** The Google wordmark, drawn as coloured letters so no image is needed. */
function GoogleLogo() {
  const letters: [string, string][] = [
    ["G", "#4285F4"],
    ["o", "#EA4335"],
    ["o", "#FBBC05"],
    ["g", "#4285F4"],
    ["l", "#34A853"],
    ["e", "#EA4335"],
  ];
  return (
    <span aria-label="Google" className="shrink-0 select-none text-[15px] font-bold tracking-tight">
      {letters.map(([letter, color], i) => (
        <span key={i} style={{ color }}>
          {letter}
        </span>
      ))}
    </span>
  );
}

function HistoryPanel({
  rows,
  onOpen,
  onClear,
}: {
  rows: BrowserHistoryRow[];
  onOpen: (url: string) => void;
  onClear: () => void;
}) {
  return (
    <section className="mx-auto mt-3 max-w-2xl px-4">
      <div className="flex items-center justify-between pb-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <Clock className="h-4 w-4 text-primary" /> History
        </h2>
        {rows.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> Clear
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Nothing here yet — your last 20 visits show up here.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map((row) => (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => row.url && onOpen(row.url)}
                className="flex w-full items-center gap-3 py-2.5 text-left"
              >
                <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {row.query || displayTitle(row.url ?? "")}
                  </span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {row.url}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BookmarksPanel({
  rows,
  onOpen,
  onRemove,
}: {
  rows: BrowserBookmarkRow[];
  onOpen: (url: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <section className="mx-auto mt-3 max-w-2xl px-4">
      <h2 className="flex items-center gap-1.5 pb-2 text-sm font-bold">
        <Bookmark className="h-4 w-4 text-primary" /> Bookmarks
      </h2>
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">
          Tap ⭐ Save in the browser bar to keep a site here.
        </p>
      ) : (
        <ul className="divide-y divide-white/5">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center gap-3 py-2.5">
              <button
                type="button"
                onClick={() => onOpen(row.url)}
                className="min-w-0 flex-1 text-left"
              >
                <span className="block truncate text-sm font-semibold">{row.title}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{row.url}</span>
              </button>
              <button
                type="button"
                onClick={() => onRemove(row.id)}
                aria-label={`Remove ${row.title}`}
                className="rounded-full p-1.5 text-muted-foreground hover:bg-white/10 hover:text-destructive"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
