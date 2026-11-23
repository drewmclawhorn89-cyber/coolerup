import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type TouchEvent as ReactTouchEvent,
} from "react";
import { ArrowDown, Flag, Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { searchGiphy } from "@/lib/giphy.functions";
import { useAuth } from "@/hooks/useAuth";
import { GifGridSkeleton, PanelSkeleton } from "@/components/Skeletons";
import {
  bumpGifUse,
  countMyGifs,
  deleteGif,
  listMyGifs,
  listTrendingGifs,
  reportGif,
  searchGifs,
  type GifPickMeta,
  type GifRow,
} from "@/lib/gif";

const MakeGif = lazy(() => import("@/components/MakeGif").then((m) => ({ default: m.MakeGif })));

type Gif = { id: string; url: string; preview: string };
type Failure = { kind: "missing-key" | "bad-key" | "network"; detail?: string | undefined };
type Tab = "trending" | "mine";

const GIF_PAGE_SIZE = 10;
const PULL_REFRESH_THRESHOLD = 48;

function mergeUniqueGifs(prev: GifRow[], next: GifRow[]): GifRow[] {
  if (!Array.isArray(next) || next.length === 0) return prev;
  const seen = new Set(prev.map((g) => g.id));
  const merged = [...prev];
  for (const row of next) {
    if (!seen.has(row.id)) {
      seen.add(row.id);
      merged.push(row);
    }
  }
  return merged;
}

/**
 * GIF picker shared by feed comments, full-video comments, LIVE chat and DMs.
 *
 * Two sources live side by side:
 *  - Coolerup GIFs made by users ("Make Your Own GIFs"), paginated 10 at a time
 *  - Giphy (search + trending), paginated 10 at a time
 *
 * Inside the comments sheet (`fill` = true), the picker stretches inside the
 * 70% height sheet and keeps the 3-column grid vertically scrollable with
 * infinite scroll and pull-to-refresh.
 */
export function GifPicker({
  onPick,
  onClose,
  className = "",
  fill = false,
}: {
  onPick: (url: string, meta?: GifPickMeta) => void;
  onClose: () => void;
  className?: string;
  /**
   * Stretch to the height of the parent instead of using a fixed max height.
   * Used inside the comments sheet, where the picker replaces the thread and
   * must not push its own buttons off the bottom of a phone screen.
   */
  fill?: boolean;
}) {
  const { user, signIn } = useAuth();
  const userId = user?.id ?? null;
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [tab, setTab] = useState<Tab>("trending");

  const [gifs, setGifs] = useState<Gif[]>([]);
  const [giphyHasMore, setGiphyHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const [mine, setMine] = useState<GifRow[]>([]);
  const [mineCount, setMineCount] = useState(0);
  const [mineHasMore, setMineHasMore] = useState(false);

  const [custom, setCustom] = useState<GifRow[]>([]);
  const [customHasMore, setCustomHasMore] = useState(false);

  const [customLoading, setCustomLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [customError, setCustomError] = useState<string | null>(null);

  const [showMaker, setShowMaker] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pullDistance, setPullDistance] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const pullStartYRef = useRef<number | null>(null);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const loadGiphy = useCallback(async (term: string) => {
    setLoading(true);
    setFailure(null);
    try {
      const res = await searchGiphy({ data: { q: term, limit: GIF_PAGE_SIZE, offset: 0 } });
      if (!res.ok) {
        setGifs([]);
        setGiphyHasMore(false);
        setFailure({ kind: res.reason, detail: res.detail });
        return;
      }
      setGifs(res.gifs);
      setGiphyHasMore(res.gifs.length === GIF_PAGE_SIZE);
    } catch (err) {
      setGifs([]);
      setGiphyHasMore(false);
      setFailure({
        kind: "network",
        detail: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  // The Giphy key lives on the server now: `searchGiphy` proxies the request and
  // returns only URLs, so no credential ever reaches the browser.
  useEffect(() => {
    if (showMaker) return;
    void loadGiphy(debouncedQ);
  }, [debouncedQ, loadGiphy, showMaker]);

  const loadCustom = useCallback(
    async ({ isRefresh = false } = {}) => {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setCustomLoading(true);
      }
      setCustomError(null);

      try {
        const trendingPromise = debouncedQ
          ? searchGifs(debouncedQ, GIF_PAGE_SIZE, 0)
          : listTrendingGifs(GIF_PAGE_SIZE, 0);

        if (!userId) {
          const trending = await trendingPromise;
          setCustom(trending);
          setCustomHasMore(trending.length === GIF_PAGE_SIZE);
          setMine([]);
          setMineCount(0);
          setMineHasMore(false);
          return;
        }

        const [trending, own, totalMine] = await Promise.all([
          trendingPromise,
          listMyGifs(userId, GIF_PAGE_SIZE, 0, debouncedQ),
          countMyGifs(userId),
        ]);

        setCustom(trending);
        setCustomHasMore(trending.length === GIF_PAGE_SIZE);
        setMine(own);
        setMineCount(totalMine || own.length);
        setMineHasMore(own.length === GIF_PAGE_SIZE);
      } catch (err) {
        setCustom([]);
        setCustomHasMore(false);
        setMine([]);
        setMineHasMore(false);
        setCustomError(err instanceof Error ? err.message : "Couldn't load Coolerup GIFs.");
      } finally {
        setCustomLoading(false);
        setRefreshing(false);
      }
    },
    [userId, debouncedQ],
  );

  useEffect(() => {
    if (showMaker) return;
    void loadCustom();
  }, [loadCustom, showMaker]);

  const activeHasMore = tab === "mine" ? mineHasMore : customHasMore || giphyHasMore;

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || customLoading || loadingMore || refreshing || !activeHasMore) {
      return;
    }
    if (tab === "mine" && !userId) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      if (tab === "mine" && userId) {
        const nextRows = await listMyGifs(userId, GIF_PAGE_SIZE, mine.length, debouncedQ);
        setMine((prev) => mergeUniqueGifs(prev, nextRows));
        setMineHasMore(nextRows.length === GIF_PAGE_SIZE);
      } else {
        const tasks: Promise<void>[] = [];
        if (customHasMore) {
          tasks.push(
            (debouncedQ
              ? searchGifs(debouncedQ, GIF_PAGE_SIZE, custom.length)
              : listTrendingGifs(GIF_PAGE_SIZE, custom.length)
            ).then((nextRows) => {
              setCustom((prev) => mergeUniqueGifs(prev, nextRows));
              setCustomHasMore(nextRows.length === GIF_PAGE_SIZE);
            }),
          );
        }
        if (giphyHasMore) {
          tasks.push(
            searchGiphy({
              data: { q: debouncedQ, limit: GIF_PAGE_SIZE, offset: gifs.length },
            }).then((res) => {
              if (!res.ok) {
                setGiphyHasMore(false);
                return;
              }
              setGifs((prev) => {
                const seen = new Set(prev.map((g) => g.id));
                return [...prev, ...res.gifs.filter((g) => !seen.has(g.id))];
              });
              setGiphyHasMore(res.gifs.length === GIF_PAGE_SIZE);
            }),
          );
        }
        await Promise.all(tasks);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load more GIFs.");
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [
    customLoading,
    loadingMore,
    refreshing,
    activeHasMore,
    tab,
    userId,
    mine.length,
    custom.length,
    customHasMore,
    giphyHasMore,
    gifs.length,
    debouncedQ,
  ]);

  const handleRefresh = useCallback(async () => {
    if (refreshing || customLoading) return;
    await Promise.all([loadCustom({ isRefresh: true }), loadGiphy(debouncedQ)]);
  }, [refreshing, customLoading, loadCustom, loadGiphy, debouncedQ]);

  // Trigger infinite scroll both via IntersectionObserver and scroll position fallback.
  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !activeHasMore) return;

    if (typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          void loadMore();
        }
      },
      { root, rootMargin: "100px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [activeHasMore, loadMore, tab, custom.length, mine.length, gifs.length]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !activeHasMore || loadingMore || customLoading) return;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 80) {
      void loadMore();
    }
  };

  const handleTouchStart = (e: ReactTouchEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || el.scrollTop > 0) {
      pullStartYRef.current = null;
      return;
    }
    pullStartYRef.current = e.touches[0]?.clientY ?? null;
  };

  const handleTouchMove = (e: ReactTouchEvent<HTMLDivElement>) => {
    const startY = pullStartYRef.current;
    const el = scrollRef.current;
    if (startY === null || !el) return;
    if (el.scrollTop > 0) {
      pullStartYRef.current = null;
      setPullDistance(0);
      return;
    }
    const currentY = e.touches[0]?.clientY ?? startY;
    const delta = currentY - startY;
    if (delta > 0) {
      setPullDistance(Math.min(72, delta * 0.45));
    } else {
      setPullDistance(0);
    }
  };

  const handleTouchEnd = () => {
    if (pullDistance >= PULL_REFRESH_THRESHOLD) {
      void handleRefresh();
    }
    pullStartYRef.current = null;
    setPullDistance(0);
  };

  const pickCustom = (gif: GifRow) => {
    bumpGifUse(gif.id);
    onPick(gif.gif_url, {
      id: gif.id,
      title: gif.title,
      username: gif.username ?? null,
    });
  };

  const remove = async (gif: GifRow) => {
    if (!window.confirm("Delete this GIF? It will disappear from comments and LIVE chat.")) return;
    setBusyId(gif.id);
    try {
      await deleteGif(gif);
      setMine((rows) => rows.filter((r) => r.id !== gif.id));
      setMineCount((c) => Math.max(0, c - 1));
      setCustom((rows) => rows.filter((r) => r.id !== gif.id));
      toast.success("GIF deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete that GIF.");
    } finally {
      setBusyId(null);
    }
  };

  const report = async (gif: GifRow) => {
    if (!user) {
      void signIn();
      return;
    }
    setBusyId(gif.id);
    try {
      await reportGif(gif.id, user.id);
      toast.success("Reported — thanks. We'll review this GIF.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't report that GIF.");
    } finally {
      setBusyId(null);
    }
  };

  if (showMaker) {
    return (
      <div className={`flex min-h-0 flex-col border-t p-0 ${fill ? "flex-1" : ""} ${className}`}>
        <Suspense fallback={<PanelSkeleton />}>
          <MakeGif
            className="min-h-0 border-t-0 p-0"
            expand={fill}
            onCreated={() => {
              setShowMaker(false);
              setTab("mine");
              void loadCustom();
            }}
            onClose={() => setShowMaker(false)}
          />
        </Suspense>
      </div>
    );
  }

  const shownCustom = tab === "mine" ? mine : custom;
  const showGiphy = tab === "trending";
  const badgeCount = Math.max(mineCount, mine.length);

  return (
    <div className={`flex min-h-0 flex-col border-t p-3 ${fill ? "flex-1" : ""} ${className}`}>
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
          }}
          placeholder="Search GIFs…"
          className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2 text-base outline-none sm:text-sm"
        />
        <button
          type="button"
          onClick={() => {
            if (!user) {
              void signIn();
              return;
            }
            setShowMaker(true);
          }}
          className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
          aria-label="Make your own GIF"
        >
          <Plus className="h-3.5 w-3.5" /> Make GIF
        </button>
        <button type="button" onClick={onClose} aria-label="Close GIF picker">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-2 flex shrink-0 gap-1 rounded-full bg-secondary/60 p-0.5 text-xs font-bold">
        <button
          type="button"
          onClick={() => {
            setTab("trending");
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
          }}
          aria-pressed={tab === "trending"}
          className={`flex-1 rounded-full py-1.5 ${
            tab === "trending" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          Trending
        </button>
        <button
          type="button"
          onClick={() => {
            setTab("mine");
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
          }}
          aria-pressed={tab === "mine"}
          className={`flex-1 rounded-full py-1.5 ${
            tab === "mine" ? "bg-background shadow-sm" : "text-muted-foreground"
          }`}
        >
          My GIFs{badgeCount > 0 ? ` (${badgeCount})` : ""}
        </button>
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="min-h-0 max-h-[400px] flex-1 touch-pan-y overflow-y-auto overscroll-contain pr-0.5"
      >
        {(pullDistance > 8 || refreshing) && (
          <div className="mb-2 flex items-center justify-center gap-1.5 rounded-lg bg-secondary/50 py-1.5 text-xs font-medium text-muted-foreground">
            {refreshing ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Refreshing GIFs…</span>
              </>
            ) : pullDistance >= PULL_REFRESH_THRESHOLD ? (
              <>
                <RefreshCw className="h-3.5 w-3.5 text-primary" />
                <span>Release to refresh GIFs</span>
              </>
            ) : (
              <>
                <ArrowDown className="h-3.5 w-3.5" />
                <span>Pull down to refresh</span>
              </>
            )}
          </div>
        )}

        {customError && (
          <p className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {customError}
          </p>
        )}

        {tab === "mine" && !user && (
          <div className="mb-2 rounded-lg bg-secondary/60 p-3 text-center text-xs text-muted-foreground">
            Sign in to make and keep your own GIFs.
            <button
              type="button"
              onClick={() => void signIn()}
              className="ml-2 rounded-full bg-primary px-3 py-1 text-[11px] font-bold text-primary-foreground"
            >
              Sign in
            </button>
          </div>
        )}

        {shownCustom.length > 0 && (
          <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {tab === "mine" ? "Your GIFs" : "Made on Coolerup"}
              </p>
              <button
                type="button"
                onClick={() => void handleRefresh()}
                disabled={refreshing || customLoading}
                aria-label="Refresh GIFs"
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {shownCustom.map((g) => {
                const isOwn = !!user && g.user_id === user.id;
                return (
                  <div key={g.id} className="group relative">
                    <button
                      type="button"
                      onClick={() => pickCustom(g)}
                      aria-label={`Pick ${g.title}`}
                      className="block w-full"
                    >
                      <img
                        src={g.gif_url}
                        alt={g.title}
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        className="h-24 w-full rounded object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 truncate rounded-b bg-black/65 px-1 py-0.5 text-left text-[9px] font-semibold text-white">
                        {g.username ? `Made by @${g.username}` : g.title}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => (isOwn ? void remove(g) : void report(g))}
                      disabled={busyId === g.id}
                      aria-label={isOwn ? `Delete ${g.title}` : `Report ${g.title}`}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 transition group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                    >
                      {busyId === g.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isOwn ? (
                        <Trash2 className="h-3 w-3" />
                      ) : (
                        <Flag className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {tab === "mine" && user && !customLoading && mine.length === 0 && (
          <p className="mb-2 rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            {debouncedQ ? (
              <>No matching GIFs in your library.</>
            ) : (
              <>
                No GIFs yet. Tap <strong>+ Make GIF</strong> to cut one from your videos.
              </>
            )}
          </p>
        )}

        {tab === "trending" && !customLoading && shownCustom.length === 0 && debouncedQ && (
          <p className="mb-2 text-xs text-muted-foreground">
            No Coolerup GIFs match &ldquo;{debouncedQ}&rdquo;.
          </p>
        )}

        {customLoading && <GifGridSkeleton count={6} className="mb-3" />}

        {showGiphy && failure && shownCustom.length === 0 && (
          <div className="mb-2 space-y-1 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {failure.kind === "missing-key" && (
              <>
                <p className="font-bold">GIF search isn't configured.</p>
                <p>
                  Set <code className="font-mono">GIPHY_API_KEY</code> on the server — free key at{" "}
                  <a
                    href="https://developers.giphy.com/dashboard/"
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    developers.giphy.com
                  </a>
                  .
                </p>
              </>
            )}
            {failure.kind === "bad-key" && (
              <>
                <p className="font-bold">Giphy rejected the API key.</p>
                <p>
                  The key is invalid, banned, or over its quota. Check{" "}
                  <code className="font-mono">GIPHY_API_KEY</code>.
                  {failure.detail ? ` (${failure.detail})` : ""}
                </p>
              </>
            )}
            {failure.kind === "network" && (
              <>
                <p className="font-bold">Couldn't reach Giphy.</p>
                <p>{failure.detail ?? "Check your connection and try again."}</p>
              </>
            )}
          </div>
        )}

        {showGiphy && gifs.length > 0 && (
          <div className="mt-2">
            {shownCustom.length > 0 && (
              <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                Giphy
              </p>
            )}
            <div className="grid grid-cols-3 gap-1.5">
              {gifs.map((g) => (
                <button
                  type="button"
                  key={g.id}
                  onClick={() => onPick(g.url)}
                  aria-label="Pick GIF"
                >
                  <img
                    src={g.preview}
                    alt="GIF"
                    loading="lazy"
                    decoding="async"
                    referrerPolicy="no-referrer"
                    className="h-24 w-full rounded bg-zinc-900 object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {showGiphy && loading && gifs.length === 0 && (
          <GifGridSkeleton count={6} className="mt-2" />
        )}

        <div ref={sentinelRef} className="h-1 w-full" aria-hidden="true" />

        {loadingMore && (
          <div className="my-2 space-y-2">
            <GifGridSkeleton count={3} />
            <p className="flex items-center justify-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading more GIFs...
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
