import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Clock,
  ExternalLink,
  Globe2,
  Home,
  Layers,
  Loader2,
  Plus,
  RotateCw,
  Search,
  ShieldAlert,
  Star,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { BrowserHome } from "@/components/BrowserHome";
import {
  COOLERUP_TABS,
  addBookmark,
  displayTitle,
  embedUrlFor,
  hostLabel,
  isBlockedUrl,
  isEmbeddable,
  isInternalUrl,
  listBookmarks,
  listHistory,
  parseInput,
  prettyUrl,
  saveHistory,
  siteById,
  urlForSite,
  youtubeIdFromBrowserUrl,
  type BrowserBookmarkRow,
  type BrowserHistoryRow,
  type SearchResult,
} from "@/lib/coolerupBrowser";
import { fetchBrowserPage, searchCoolerupBrowser } from "@/lib/coolerupBrowser.functions";
import { addYouTubeSong } from "@/lib/youtubeSongs";

/* -------------------------------------------------------------------------- */
/* Model                                                                      */
/* -------------------------------------------------------------------------- */

type Entry =
  | { kind: "home" }
  | {
      kind: "results";
      query: string;
      results: SearchResult[];
      source: string;
      status: "loading" | "done" | "error";
    }
  | { kind: "site"; url: string };

type Tab = { id: string; entries: Entry[]; index: number };

let seq = 0;
const newId = () => `tab-${++seq}`;

const makeTab = (): Tab => ({ id: newId(), entries: [{ kind: "home" }], index: 0 });

const entryTitle = (entry: Entry | undefined): string => {
  if (!entry) return "New tab";
  if (entry.kind === "home") return "Coolerup";
  if (entry.kind === "results") return entry.query;
  return displayTitle(entry.url);
};

const entryUrl = (entry: Entry | undefined): string | null => {
  if (!entry) return null;
  if (entry.kind === "home") return "coolerup://home";
  if (entry.kind === "results") return `coolerup://search?q=${encodeURIComponent(entry.query)}`;
  return entry.url;
};

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

export function CoolerupBrowser() {
  const navigate = useNavigate();
  const auth = useAuth();
  const addSong = useServerFn(addYouTubeSong);
  const runSearch = useServerFn(searchCoolerupBrowser);

  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0]!.id);
  const [address, setAddress] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [history, setHistory] = useState<BrowserHistoryRow[]>([]);
  const [bookmarks, setBookmarks] = useState<BrowserBookmarkRow[]>([]);
  const [musicUrl, setMusicUrl] = useState("");
  const [addingSong, setAddingSong] = useState(false);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0]!;
  const entry = activeTab.entries[activeTab.index];
  const currentUrl = entryUrl(entry);
  const canBack = activeTab.index > 0;
  const canForward = activeTab.index < activeTab.entries.length - 1;
  const saved = useMemo(
    () => !!currentUrl && !isInternalUrl(currentUrl) && bookmarks.some((b) => b.url === currentUrl),
    [bookmarks, currentUrl],
  );

  const refreshPanels = useCallback(async () => {
    const [h, b] = await Promise.all([listHistory(), listBookmarks()]);
    setHistory(h);
    setBookmarks(b);
  }, []);

  useEffect(() => {
    void refreshPanels();
  }, [refreshPanels]);

  /* Keep the address bar in step with navigation (but not with typing). */
  useEffect(() => {
    if (!entry) return;
    if (entry.kind === "home") setAddress("");
    else if (entry.kind === "results") setAddress(entry.query);
    else setAddress(entry.url);
  }, [entry]);

  const push = useCallback(
    (next: Entry) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeId) return tab;
          const entries = [...tab.entries.slice(0, tab.index + 1), next];
          return { ...tab, entries, index: entries.length - 1 };
        }),
      );
    },
    [activeId],
  );

  const replaceTop = useCallback(
    (next: Entry) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== activeId) return tab;
          const entries = [...tab.entries];
          entries[tab.index] = next;
          return { ...tab, entries };
        }),
      );
    },
    [activeId],
  );

  /** Run a Coolerup search and show the branded results page. */
  const doSearch = useCallback(
    async (query: string) => {
      const trimmed = query.trim();
      if (!trimmed) return;
      push({ kind: "results", query: trimmed, results: [], source: "", status: "loading" });
      void saveHistory({
        query: trimmed,
        url: `coolerup://search?q=${encodeURIComponent(trimmed)}`,
      }).then(refreshPanels);
      try {
        const response = await runSearch({ data: { q: trimmed } });
        if (response.ok) {
          replaceTop({
            kind: "results",
            query: trimmed,
            results: response.results,
            source: response.source,
            status: "done",
          });
        } else {
          replaceTop({ kind: "results", query: trimmed, results: [], source: "", status: "error" });
        }
      } catch {
        replaceTop({ kind: "results", query: trimmed, results: [], source: "", status: "error" });
      }
    },
    [push, replaceTop, refreshPanels, runSearch],
  );

  /** Open a real site in the viewport. */
  const openUrl = useCallback(
    (url: string) => {
      if (isBlockedUrl(url)) {
        toast.error("That site is blocked in Coolerup Browser.");
        return;
      }
      push({ kind: "site", url });
      void saveHistory({ url }).then(refreshPanels);
    },
    [push, refreshPanels],
  );

  /* Link taps inside a proxied page come back as postMessages so navigation
     stays in the Coolerup chrome instead of escaping to another origin. */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { coolerupNavigate?: unknown } | null;
      if (data && typeof data.coolerupNavigate === "string") openUrl(data.coolerupNavigate);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [openUrl]);

  /* Deep links from History / Bookmarks: /browser?q=... or /browser?url=... */
  const { q: deepQuery, url: deepUrl } = useSearch({ from: "/browser/" });
  const deepRan = useRef<string | null>(null);
  useEffect(() => {
    if (deepQuery && deepRan.current !== `q:${deepQuery}`) {
      deepRan.current = `q:${deepQuery}`;
      void doSearch(deepQuery);
      return;
    }
    if (deepUrl && deepRan.current !== `u:${deepUrl}`) {
      deepRan.current = `u:${deepUrl}`;
      openUrl(deepUrl);
    }
  }, [deepQuery, deepUrl, doSearch, openUrl]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = parseInput(address);
    if (parsed.kind === "empty") return;
    if (parsed.kind === "url") openUrl(parsed.url);
    else void doSearch(parsed.query);
  };

  const pickTab = (siteId: string) => {
    const site = siteById(siteId);
    if (!site) return;
    if (site.id === "coolerup") {
      push({ kind: "home" });
      return;
    }
    const parsed = parseInput(address);
    const query = parsed.kind === "search" ? parsed.query : "";
    openUrl(urlForSite(site, query));
  };

  const goBack = () =>
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeId && tab.index > 0 ? { ...tab, index: tab.index - 1 } : tab,
      ),
    );
  const goForward = () =>
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeId && tab.index < tab.entries.length - 1
          ? { ...tab, index: tab.index + 1 }
          : tab,
      ),
    );

  const addTab = () => {
    const tab = makeTab();
    setTabs((prev) => [...prev, tab]);
    setActiveId(tab.id);
    setAddress("");
    setShowGrid(false);
  };

  const closeTab = (id: string) => {
    setTabs((prev) => {
      if (prev.length === 1) return [makeTab()];
      const next = prev.filter((tab) => tab.id !== id);
      if (id === activeId) setActiveId(next[next.length - 1]!.id);
      return next;
    });
  };

  const saveCurrent = async () => {
    if (!currentUrl || isInternalUrl(currentUrl)) return;
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    const ok = await addBookmark(currentUrl, displayTitle(currentUrl));
    if (ok) {
      toast.success("Saved to Coolerup bookmarks");
      await refreshPanels();
    } else {
      toast.error("Could not save that site.");
    }
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
    const url = musicUrl.trim() || (entry?.kind === "site" ? entry.url : "");
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
    entry?.kind === "site" &&
    (entry.url.includes("youtube.com") || !!youtubeIdFromBrowserUrl(entry.url));

  const activeSiteId = useMemo(() => {
    if (!entry || entry.kind === "home" || entry.kind === "results") return "coolerup";
    try {
      const host = new URL(entry.url).hostname.replace(/^www\./, "");
      const match = COOLERUP_TABS.find((site) => {
        if (site.id === "coolerup") return false;
        try {
          const home = new URL(site.home).hostname.replace(/^www\./, "");
          return host === home || host.endsWith(`.${home}`);
        } catch {
          return false;
        }
      });
      return match?.id ?? "coolerup";
    } catch {
      return "coolerup";
    }
  }, [entry]);

  const controlClass =
    "flex h-8 w-8 items-center justify-center rounded-full bg-[#2563EB] text-white shadow-sm ring-1 ring-white/10 transition hover:bg-[#1d4fc4] disabled:bg-white/10 disabled:text-white/25 disabled:ring-0";

  return (
    <div className="min-h-dvh bg-[#0b1220] pb-32 text-white">
      {/* ---------------------------------------------------------------- */}
      {/* Chrome                                                            */}
      {/* ---------------------------------------------------------------- */}
      <div className="sticky top-0 z-30 border-b border-black/20 bg-[#2563EB] shadow-lg shadow-blue-950/30">
        {/* Brand row */}
        <div className="mx-auto flex max-w-2xl items-center gap-2 px-3 pb-1.5 pt-[max(0.6rem,env(safe-area-inset-top))]">
          <button
            type="button"
            onClick={() => void navigate({ to: "/" })}
            aria-label="Back to Coolerup"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="flex items-center gap-1.5 text-[15px] font-black tracking-tight">
            <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white text-[#2563EB]">
              <Globe2 className="h-4 w-4" />
            </span>
            Coolerup Browser
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              onClick={() => void navigate({ to: "/browser/history" })}
              aria-label="History"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
            >
              <Clock className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => void navigate({ to: "/browser/bookmarks" })}
              aria-label="Bookmarks"
              className="flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
            >
              <Bookmark className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowGrid((v) => !v)}
              aria-label="Tabs"
              className="relative flex h-8 w-8 items-center justify-center rounded-full text-white/90 hover:bg-white/15"
            >
              <Layers className="h-4 w-4" />
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-black text-[#2563EB]">
                {tabs.length}
              </span>
            </button>
          </div>
        </div>

        {/* Search pill */}
        <div className="mx-auto max-w-2xl px-3 pb-2">
          <form
            onSubmit={submit}
            className="flex items-center gap-2 rounded-full bg-white px-3 shadow-sm ring-1 ring-black/5"
          >
            <Search className="h-4 w-4 shrink-0 text-[#2563EB]" />
            <input
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              placeholder="Search Coolerup Browser or type URL..."
              aria-label="Search Coolerup Browser or type a URL"
              inputMode="search"
              autoComplete="off"
              spellCheck={false}
              className="h-10 w-full min-w-0 bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-500"
            />
            {address && (
              <button
                type="button"
                onClick={() => setAddress("")}
                aria-label="Clear"
                className="shrink-0"
              >
                <X className="h-4 w-4 text-neutral-400" />
              </button>
            )}
          </form>
        </div>

        {/* Site strip — wraps, so no tap is ever cut off */}
        <div className="mx-auto max-w-2xl px-3 pb-2">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {COOLERUP_TABS.map((site) => (
              <button
                key={site.id}
                type="button"
                onClick={() => pickTab(site.id)}
                aria-pressed={activeSiteId === site.id}
                className={`shrink-0 border-b-2 pb-1.5 text-[13px] font-semibold ${
                  activeSiteId === site.id
                    ? "border-white text-white"
                    : "border-transparent text-white/60"
                }`}
              >
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden className="text-[12px] leading-none">
                    {site.emoji}
                  </span>
                  {site.label}
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Add to Music */}
      {showMusicBar && (
        <form onSubmit={addToMusic} className="mx-auto mt-3 flex max-w-2xl items-center gap-2 px-3">
          <input
            value={musicUrl}
            onChange={(event) => setMusicUrl(event.target.value)}
            placeholder="Paste a YouTube song link…"
            aria-label="Paste a YouTube song link"
            className="h-9 min-w-0 flex-1 rounded-full bg-white/10 px-3 text-xs outline-none placeholder:text-white/40"
          />
          <button
            type="submit"
            disabled={addingSong}
            className="flex shrink-0 items-center gap-1 rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white ring-1 ring-white/20 hover:bg-[#1d4fc4] disabled:opacity-60"
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

      {/* Tab grid */}
      {showGrid && (
        <div className="mx-auto max-w-2xl px-3 pt-3">
          <div className="grid grid-cols-2 gap-2">
            {tabs.map((tab) => {
              const current = tab.entries[tab.index];
              return (
                <div
                  key={tab.id}
                  className={`flex items-center gap-2 rounded-xl border p-2.5 ${
                    tab.id === activeId
                      ? "border-[#2563EB] bg-[#2563EB]/15"
                      : "border-white/10 bg-white/[0.05]"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveId(tab.id);
                      setShowGrid(false);
                    }}
                    className="min-w-0 flex-1 text-left"
                  >
                    <span className="block truncate text-xs font-bold">{entryTitle(current)}</span>
                    <span className="block truncate text-[10px] text-white/40">
                      {entryUrl(current) ?? "New tab"}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => closeTab(tab.id)}
                    aria-label={`Close ${entryTitle(current)}`}
                    className="rounded-full p-1 text-white/50 hover:bg-white/15 hover:text-white"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              onClick={addTab}
              className="flex min-h-[3.5rem] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/20 text-xs font-bold text-white/60 hover:border-[#2563EB] hover:text-white"
            >
              <Plus className="h-4 w-4" /> New Tab
            </button>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="mx-auto flex max-w-2xl items-center gap-1.5 px-3 py-2">
        <button
          type="button"
          onClick={goBack}
          disabled={!canBack}
          aria-label="Back"
          className={controlClass}
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={goForward}
          disabled={!canForward}
          aria-label="Forward"
          className={controlClass}
        >
          <ArrowRight className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => setReloadKey((k) => k + 1)}
          aria-label="Refresh"
          className={controlClass}
        >
          <RotateCw className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => push({ kind: "home" })}
          aria-label="Home"
          className={controlClass}
        >
          <Home className="h-4 w-4" />
        </button>

        <div className="mx-1 min-w-0 flex-1 truncate rounded-full bg-white/[0.07] px-3 py-1.5 text-[11px] text-white/55">
          {currentUrl ?? "New tab"}
        </div>

        <button
          type="button"
          onClick={() => void saveCurrent()}
          disabled={!currentUrl || isInternalUrl(currentUrl)}
          aria-label={saved ? "Saved" : "Save to Coolerup"}
          className={`${controlClass} ${saved ? "text-amber-300" : ""}`}
        >
          <Star className={`h-4 w-4 ${saved ? "fill-current" : ""}`} />
        </button>
        <button
          type="button"
          onClick={() => currentUrl && openExternal(currentUrl)}
          disabled={!currentUrl || isInternalUrl(currentUrl) || isBlockedUrl(currentUrl)}
          aria-label="Open in Chrome"
          className={controlClass}
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Viewport                                                          */}
      {/* ---------------------------------------------------------------- */}
      <div className="mx-auto max-w-2xl px-3">
        {!entry || entry.kind === "home" ? (
          <div className="overflow-hidden rounded-2xl border border-white/10">
            <BrowserHome
              recent={history}
              onOpenShortcut={(shortcut) => {
                if (shortcut.internal) void navigate({ to: shortcut.href });
                else openUrl(shortcut.href);
              }}
              onOpenUrl={openUrl}
              onSearch={(query) => void doSearch(query)}
            />
          </div>
        ) : entry.kind === "results" ? (
          <ResultsView
            entry={entry}
            onOpen={openUrl}
            onSearch={(query) => void doSearch(query)}
            onRetry={() => void doSearch(entry.query)}
          />
        ) : isBlockedUrl(entry.url) ? (
          <BlockedView url={entry.url} />
        ) : embedUrlFor(entry.url) ? (
          /* YouTube / TikTok video links play inside Coolerup. */
          <iframe
            key={`${entry.url}-${reloadKey}`}
            src={embedUrlFor(entry.url) ?? ""}
            title="Coolerup Browser player"
            className="h-[68vh] w-full rounded-2xl border border-white/10 bg-black"
            referrerPolicy="strict-origin-when-cross-origin"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
            allow="clipboard-write; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
          />
        ) : isEmbeddable(entry.url) ? (
          <iframe
            key={`${entry.url}-${reloadKey}`}
            src={entry.url}
            title="Coolerup Browser"
            className="h-[68vh] w-full rounded-2xl border border-white/10 bg-white"
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
            allow="clipboard-write; encrypted-media; picture-in-picture; fullscreen"
          />
        ) : (
          /* TikTok, Instagram, X and friends refuse framing. Coolerup fetches
             the page itself so it still opens in-app instead of bouncing out. */
          <ProxyView
            url={entry.url}
            reloadKey={reloadKey}
            onOpenExternal={openExternal}
            onNavigate={openUrl}
          />
        )}
      </div>

      <p className="mx-auto max-w-2xl px-4 py-2 text-[11px] text-white/35">
        SafeSearch is on. Downloads are off — only images can open outside Coolerup.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Views                                                                      */
/* -------------------------------------------------------------------------- */

function ResultsView({
  entry,
  onOpen,
  onSearch,
  onRetry,
}: {
  entry: Extract<Entry, { kind: "results" }>;
  onOpen: (url: string) => void;
  onSearch: (query: string) => void;
  onRetry: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0b1220]">
      <div className="border-b border-white/10 bg-gradient-to-br from-[#2563EB]/25 to-transparent px-4 py-3">
        <p className="text-[11px] font-bold uppercase tracking-wider text-white/45">
          Coolerup Search
        </p>
        <h2 className="truncate text-base font-black">{entry.query}</h2>
        {entry.status === "done" && (
          <p className="text-[11px] text-white/40">
            {entry.results.length} results · {entry.source}
          </p>
        )}
      </div>

      {entry.status === "loading" ? (
        <div className="flex flex-col items-center gap-2 py-14 text-white/50">
          <Loader2 className="h-6 w-6 animate-spin text-[#2563EB]" />
          <p className="text-xs font-semibold">Searching Coolerup…</p>
        </div>
      ) : entry.status === "error" || entry.results.length === 0 ? (
        <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
          <ShieldAlert className="h-7 w-7 text-white/40" />
          <p className="text-sm font-bold">No results for “{entry.query}”</p>
          <p className="text-xs text-white/45">
            Try different words, or open a site directly from the tabs above.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white"
          >
            Search again
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-white/[0.06]">
          {entry.results.map((result, i) => (
            <li key={`${result.url}-${i}`}>
              <button
                type="button"
                onClick={() => onOpen(result.url)}
                className="block w-full px-4 py-3 text-left transition hover:bg-white/[0.04]"
              >
                <span className="flex items-center gap-1.5 text-[11px] text-white/40">
                  <span className="flex h-4 w-4 items-center justify-center rounded bg-[#2563EB]/25 text-[9px] font-black text-blue-200">
                    {result.host.charAt(0).toUpperCase()}
                  </span>
                  {prettyUrl(result.url)}
                </span>
                <span className="mt-0.5 block text-[15px] font-bold leading-snug text-[#93c5fd]">
                  {result.title}
                </span>
                {result.snippet && (
                  <span className="mt-1 block text-xs leading-relaxed text-white/55">
                    {result.snippet}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {entry.status === "done" && entry.results.length > 0 && (
        <div className="border-t border-white/10 px-4 py-3">
          <p className="pb-2 text-[11px] font-bold uppercase tracking-wider text-white/35">
            Search again
          </p>
          <div className="flex flex-wrap gap-2">
            {[`${entry.query} youtube`, `${entry.query} wiki`, `${entry.query} news`].map(
              (next) => (
                <button
                  key={next}
                  type="button"
                  onClick={() => onSearch(next)}
                  className="rounded-full border border-white/10 bg-white/[0.06] px-2.5 py-1 text-[11px] font-semibold text-white/70 hover:border-[#2563EB]/60 hover:text-white"
                >
                  {next}
                </button>
              ),
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BlockedView({ url }: { url: string }) {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0b1220] px-6 text-center">
      <ShieldAlert className="h-9 w-9 text-red-400" />
      <p className="text-sm font-bold">This site is blocked</p>
      <p className="max-w-sm text-xs text-white/50">
        Coolerup Browser blocks adult content and dangerous downloads. That includes{" "}
        <span className="break-all font-mono">{url}</span>.
      </p>
    </div>
  );
}

/**
 * Renders a site that refuses to be framed.
 *
 * Coolerup fetches the page on the server, strips anything executable, and
 * paints the result with `srcDoc`. The page therefore opens *inside* the
 * browser — TikTok, Instagram and X all work — with the Coolerup top bar
 * still in place. If the fetch itself fails we fall back to the "Open in
 * Chrome" popup rather than showing a blank box.
 */
function ProxyView({
  url,
  reloadKey,
  onOpenExternal,
  onNavigate,
}: {
  url: string;
  reloadKey: number;
  onOpenExternal: (url: string) => void;
  onNavigate: (url: string) => void;
}) {
  const fetchPage = useServerFn(fetchBrowserPage);
  const [state, setState] = useState<
    | { status: "loading" }
    | {
        status: "ok";
        mode: "page" | "summary";
        html: string;
        title: string;
        description: string;
        image: string;
        links: { label: string; url: string }[];
      }
    | { status: "error" }
  >({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    fetchPage({ data: { url } })
      .then((page) => {
        if (!alive) return;
        setState(
          page.ok
            ? {
                status: "ok",
                mode: page.mode,
                html: page.html,
                title: page.title,
                description: page.description,
                image: page.image,
                links: page.links,
              }
            : { status: "error" },
        );
      })
      .catch(() => {
        if (alive) setState({ status: "error" });
      });
    return () => {
      alive = false;
    };
  }, [url, reloadKey, fetchPage]);

  if (state.status === "loading") {
    return (
      <div className="flex h-[68vh] flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0b1220] text-center">
        <Loader2 className="h-6 w-6 animate-spin text-[#93c5fd]" />
        <p className="text-xs text-white/50">Opening {hostLabel(url)} inside Coolerup…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return <FrameBlockedView url={url} onOpenExternal={onOpenExternal} />;
  }

  if (state.mode === "summary") {
    return (
      <div className="rounded-2xl border border-white/10 bg-[#111a2e] p-4">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#2563EB] text-[13px] font-black text-white">
            {hostLabel(url).charAt(0).toUpperCase()}
          </span>
          <span className="truncate text-[11px] font-bold uppercase tracking-wide text-white/45">
            {hostLabel(url)}
          </span>
        </div>
        <h2 className="mt-3 text-lg font-black leading-snug text-white">{state.title}</h2>
        {state.description && (
          <p className="mt-2 text-sm leading-relaxed text-white/65">{state.description}</p>
        )}
        {state.image && (
          <img
            src={state.image}
            alt=""
            className="mt-3 max-h-56 w-full rounded-xl border border-white/10 object-cover"
            loading="lazy"
          />
        )}
        <p className="mt-4 rounded-xl bg-white/5 px-3 py-2 text-[11px] leading-relaxed text-white/45">
          {hostLabel(url)} builds its page with JavaScript, so Coolerup shows the page summary
          instead. Everything else still opens right here.
        </p>
        {state.links.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {state.links.slice(0, 6).map((link) => (
              <button
                key={link.url}
                type="button"
                onClick={() => onNavigate(link.url)}
                className="max-w-full truncate rounded-full bg-[#2563EB]/20 px-3 py-1 text-[11px] font-semibold text-[#93c5fd] hover:bg-[#2563EB]/35"
              >
                {link.label}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={() => onOpenExternal(url)}
          className="mt-4 flex w-full items-center justify-center gap-1.5 rounded-full bg-[#2563EB] px-4 py-2 text-xs font-bold text-white hover:bg-[#1d4fc4]"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open {hostLabel(url)} in Chrome
        </button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-white">
      <div className="flex items-center justify-between gap-2 bg-[#1d4fc4] px-3 py-1.5">
        <span className="truncate text-[11px] font-bold text-white/80">
          Coolerup view · {hostLabel(url)}
        </span>
        <button
          type="button"
          onClick={() => onOpenExternal(url)}
          className="shrink-0 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-white/25"
        >
          Open in Chrome
        </button>
      </div>
      <iframe
        key={`${url}-${reloadKey}`}
        srcDoc={state.html}
        title="Coolerup Browser"
        className="h-[64vh] w-full bg-white"
        referrerPolicy="no-referrer"
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms"
      />
    </div>
  );
}

function FrameBlockedView({
  url,
  onOpenExternal,
}: {
  url: string;
  onOpenExternal: (url: string) => void;
}) {
  return (
    <div className="flex h-[50vh] flex-col items-center justify-center gap-3 rounded-2xl border border-white/10 bg-[#0b1220] px-6 text-center">
      <span className="text-4xl" aria-hidden>
        🔒
      </span>
      <p className="text-sm font-bold">This site can&apos;t open inside Coolerup Browser</p>
      <p className="max-w-sm text-xs text-white/50">
        {hostLabel(url)} blocks being shown in another app. You can still open it in Chrome.
      </p>
      <button
        type="button"
        onClick={() => onOpenExternal(url)}
        className="flex items-center gap-1.5 rounded-full bg-[#2563EB] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#1d4fc4]"
      >
        <ExternalLink className="h-3.5 w-3.5" /> Open in Chrome
      </button>
    </div>
  );
}
