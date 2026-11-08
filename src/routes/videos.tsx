import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ArrowLeft, Search, Upload, WifiOff } from "lucide-react";
import { FullVideoCard } from "@/components/FullVideoCard";
import { EditFullVideoDialog } from "@/components/EditFullVideoDialog";
import { useAuth } from "@/hooks/useAuth";
import { hasOfflineAccess, offlinePlan } from "@/lib/subscriptions";
import { useTrial } from "@/lib/trial";
import { FULL_VIDEO_CATEGORIES, listFullVideos, type FullVideo } from "@/lib/fullVideos";
import { listSavedFullVideos, onOfflineChange } from "@/lib/offline";

/**
 * How many cards to fetch per page. Two screens' worth on a phone, so the grid
 * feels populated immediately without pulling the whole library down.
 */
const PAGE_SIZE = 12;

export const Route = createFileRoute("/videos")({
  head: () => ({
    meta: [
      { title: "Videos — Coolerup" },
      {
        name: "description",
        content: "Watch full-length videos on Coolerup — music, gaming, comedy and more.",
      },
      { property: "og:title", content: "Videos — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const auth = useAuth();
  // Offline mode ships with Pro and VIP, with one free hour to try it.
  const offlineUnlocked = hasOfflineAccess(auth.handle);
  const trial = useTrial(auth.handle, offlinePlan().id);
  const navigate = useNavigate();

  const [category, setCategory] = useState<string>("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [videos, setVideos] = useState<FullVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FullVideo | null>(null);
  /** When true the grid shows only videos downloaded for offline viewing. */
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [savedVideos, setSavedVideos] = useState<FullVideo[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);

  /** Guards against a stale page landing after the filters changed. */
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Debounce typing so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  /** First page for the current filters. */
  const load = useCallback(async () => {
    // The offline shelf is read from IndexedDB, not the network.
    if (offlineOnly) return;
    const token = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      // `viewerId` keeps in-flight uploads visible to their owner only.
      const page = await listFullVideos({
        category,
        search,
        limit: PAGE_SIZE,
        offset: 0,
        viewerId: auth.user?.id ?? null,
      });
      if (token !== requestRef.current) return;
      setVideos(page);
      // A short page means there is nothing after it.
      setHasMore(page.length === PAGE_SIZE);
    } catch (err) {
      if (token !== requestRef.current) return;
      setError(err instanceof Error ? err.message : "Could not load videos.");
      setVideos([]);
      setHasMore(false);
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
  }, [category, search, auth.user?.id, offlineOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Read the offline shelf, and keep it fresh as downloads are added/removed. */
  useEffect(() => {
    if (!offlineOnly) return;
    let alive = true;
    const refresh = () => {
      setSavedLoading(true);
      void listSavedFullVideos()
        .then((rows) => {
          if (alive) setSavedVideos(rows.map((r) => r.video));
        })
        .catch(() => {
          if (alive) setSavedVideos([]);
        })
        .finally(() => {
          if (alive) setSavedLoading(false);
        });
    };
    refresh();
    const off = onOfflineChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [offlineOnly]);

  /** Append the next page. Safe to call repeatedly; the guard prevents doubles. */
  const loadMore = useCallback(async () => {
    if (offlineOnly || loadingMore || loading || !hasMore) return;
    const token = requestRef.current;
    setLoadingMore(true);
    try {
      const page = await listFullVideos({
        category,
        search,
        limit: PAGE_SIZE,
        offset: videos.length,
        viewerId: auth.user?.id ?? null,
      });
      if (token !== requestRef.current) return;
      setVideos((prev) => {
        // Dedupe: a video created between pages would otherwise appear twice.
        const seen = new Set(prev.map((v) => v.id));
        return [...prev, ...page.filter((v) => !seen.has(v.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch {
      // Leave `hasMore` alone so scrolling again retries.
    } finally {
      if (token === requestRef.current) setLoadingMore(false);
    }
  }, [offlineOnly, loadingMore, loading, hasMore, videos.length, category, search, auth.user?.id]);

  /**
   * Fetch the next page as the sentinel scrolls into view, so the grid grows
   * as you scroll instead of downloading everything up front.
   */
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || offlineOnly) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      // Start loading a bit before the sentinel is actually visible.
      { rootMargin: "600px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [hasMore, loadMore, offlineOnly]);

  const startUpload = () => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    void navigate({ to: "/upload-full" });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-24 pt-3">
      {/* Search bar, YouTube style: a wide rounded field with the icon inside. */}
      <div className="sticky top-0 z-20 -mx-3 bg-background/95 px-3 pb-2 pt-1 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
          className="flex items-center gap-2"
        >
          {/* Same back affordance the other tabs use. */}
          <Link
            to="/"
            aria-label="Back to feed"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground hover:bg-accent"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border bg-card px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search full videos"
              aria-label="Search full videos"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            onClick={startUpload}
            aria-label="Upload a full video"
            className="flex shrink-0 items-center gap-1 rounded-full create-pink px-3 py-2 text-sm font-semibold"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </form>

        {/* Category chips */}
        <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1 no-scrollbar">
          {FULL_VIDEO_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                category === c
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              {c}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setOfflineOnly((v) => !v)}
            aria-pressed={offlineOnly}
            title="Show videos downloaded for offline viewing"
            className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
              offlineOnly
                ? "bg-emerald-600 text-white"
                : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            <WifiOff className="h-3.5 w-3.5" />
            Offline
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {offlineOnly ? (
        savedLoading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : savedVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <WifiOff className="h-8 w-8 text-muted-foreground" />
            <p className="mt-3 text-base font-semibold">Nothing saved offline yet</p>
            <p className="mt-1 max-w-xs text-sm text-muted-foreground">
              {offlineUnlocked
                ? "Open any video and tap Download on the watch page to keep it available without a connection."
                : trial.used
                  ? `Your free trial has ended. Offline downloads are part of ${offlinePlan().label} and VIP.`
                  : "Start a free one-hour trial from any video's watch page, or upgrade to " +
                    `${offlinePlan().label} to save videos for offline viewing.`}
            </p>
            <button
              type="button"
              onClick={() => setOfflineOnly(false)}
              className="mt-4 rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent"
            >
              Browse all videos
            </button>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
            {savedVideos.map((v) => (
              <FullVideoCard key={v.id} video={v} />
            ))}
          </div>
        )
      ) : loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-base font-semibold">No videos here yet</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {search
              ? `Nothing matched "${search}". Try a different search.`
              : "Be the first to upload a full-length video to this category."}
          </p>
          <button
            type="button"
            onClick={startUpload}
            className="mt-4 rounded-full create-pink px-4 py-2 text-sm font-semibold"
          >
            Upload a video
          </button>
        </div>
      ) : (
        /* Two columns on phones, more as the screen grows — like YouTube's grid. */
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {videos.map((v) => (
            <FullVideoCard
              key={v.id}
              video={v}
              onEdit={auth.user && v.user_id === auth.user.id ? setEditing : undefined}
            />
          ))}
        </div>
      )}

      {!offlineOnly && videos.length > 0 && (
        <div className="mt-6 flex flex-col items-center gap-3">
          {/* Scroll target: the next page loads as this comes into view. */}
          <div ref={sentinelRef} aria-hidden className="h-px w-full" />

          {loadingMore && (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading more…
            </div>
          )}

          {hasMore && !loadingMore && (
            <button
              type="button"
              onClick={() => void loadMore()}
              className="rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent"
            >
              Load more
            </button>
          )}

          {!hasMore && (
            <p className="py-2 text-[13px] text-muted-foreground">That's everything for now.</p>
          )}

          <Link to="/" className="text-sm text-muted-foreground underline">
            Back to the feed
          </Link>
        </div>
      )}

      {/* Owner-only editor, opened from the pencil on a card. */}
      {editing && auth.user && (
        <EditFullVideoDialog
          video={editing}
          userId={auth.user.id}
          open
          onClose={() => setEditing(null)}
          onSaved={(next) => setVideos((prev) => prev.map((v) => (v.id === next.id ? next : v)))}
          onDeleted={(id) => setVideos((prev) => prev.filter((v) => v.id !== id))}
        />
      )}
    </div>
  );
}
