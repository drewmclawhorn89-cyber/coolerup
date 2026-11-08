import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Download,
  HardDrive,
  Loader2,
  Play,
  Search,
  Trash2,
  Upload,
  WifiOff,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { FullVideoCard } from "@/components/FullVideoCard";
import { EditFullVideoDialog } from "@/components/EditFullVideoDialog";
import { useAuth } from "@/hooks/useAuth";
import { useNetwork } from "@/lib/network";
import {
  FULL_VIDEO_CATEGORIES,
  formatDuration,
  listFullVideos,
  resolveFullVideoUrl,
  timeAgo,
  type FullVideo,
} from "@/lib/fullVideos";
import { listOfflineVideos, type OfflineVideoMeta } from "@/lib/db";
import {
  clearAllDownloads,
  formatBytes,
  formatStorage,
  getOfflineUsage,
  onOfflineChange,
  removeDownloadedVideo,
  type OfflineUsage,
} from "@/lib/offline";

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
      { property: "twitter:card", content: "summary" },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const network = useNetwork();
  const online = network.online;

  const [category, setCategory] = useState<string>("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [videos, setVideos] = useState<FullVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FullVideo | null>(null);

  /* ---------------- offline state ---------------- */

  /** When true the grid shows only downloaded videos (YouTube's Offline tab). */
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [offlineVideos, setOfflineVideos] = useState<OfflineVideoMeta[]>([]);
  const [usage, setUsage] = useState<OfflineUsage>({ used: 0, max: 500 * 1024 * 1024, count: 0 });

  /** Guards against a stale page landing after the filters changed. */
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  /** Mirror of `usage.count` so the load callback can read it without re-running. */
  const hasDownloadsRef = useRef(false);

  // Debounce typing so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  /** Reload the downloaded list + storage meter. */
  const refreshOffline = useCallback(async () => {
    try {
      const [rows, nextUsage] = await Promise.all([listOfflineVideos(), getOfflineUsage()]);
      setOfflineVideos(rows);
      setUsage(nextUsage);
      hasDownloadsRef.current = nextUsage.count > 0;
    } catch {
      setOfflineVideos([]);
    }
  }, []);

  useEffect(() => {
    void refreshOffline();
    const off = onOfflineChange(() => void refreshOffline());
    return off;
  }, [refreshOffline]);

  /**
   * Losing signal drops the tab straight into Offline mode, exactly like
   * YouTube. Coming back online leaves the user where they are; they can tap
   * the toggle off themselves.
   */
  useEffect(() => {
    if (!online) setOfflineOnly(true);
  }, [online]);

  /** First page for the current filters. */
  const load = useCallback(async () => {
    // No point hitting Supabase with no connection — the offline grid is the
    // only thing that can work, and it is driven by IndexedDB instead.
    if (!online) {
      setLoading(false);
      setVideos([]);
      setHasMore(false);
      return;
    }
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
      // A "1 bar" connection often still reports online while requests fail.
      // If anything is downloaded, drop into Offline mode instead of showing
      // an error over a grid that could have worked.
      if (hasDownloadsRef.current) {
        setOfflineOnly(true);
        return;
      }
      setError(err instanceof Error ? err.message : "Could not load videos.");
      setVideos([]);
      setHasMore(false);
    } finally {
      if (token === requestRef.current) setLoading(false);
    }
  }, [category, search, auth.user?.id, online]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Append the next page. Safe to call repeatedly; the guard prevents doubles. */
  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !hasMore || !online) return;
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
  }, [loadingMore, loading, hasMore, videos.length, category, search, auth.user?.id, online]);

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
    if (!online) {
      toast.error("You're offline. Connect to upload a video.");
      return;
    }
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    void navigate({ to: "/upload-full" });
  };

  const deleteOne = async (id: string) => {
    try {
      await removeDownloadedVideo(id);
      await refreshOffline();
      toast.success("Download deleted — space freed");
    } catch {
      toast.error("Couldn't delete this download");
    }
  };

  const deleteAll = async () => {
    if (usage.count === 0) return;
    if (!window.confirm("Delete all downloaded videos and free up offline storage?")) return;
    try {
      await clearAllDownloads();
      await refreshOffline();
      toast.success("Offline storage cleared");
    } catch {
      toast.error("Couldn't clear offline storage");
    }
  };

  const usedPct = Math.min(100, Math.round((usage.used / usage.max) * 100));

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

        {/* Category chips + the Offline toggle, like YouTube's Downloads tab. */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 no-scrollbar">
            {FULL_VIDEO_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                aria-pressed={category === c}
                disabled={offlineOnly}
                className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition disabled:opacity-40 ${
                  category === c
                    ? "bg-foreground text-background"
                    : "bg-secondary text-secondary-foreground hover:bg-accent"
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setOfflineOnly((v) => !v)}
            aria-pressed={offlineOnly}
            aria-label="Show only downloaded videos"
            disabled={!online}
            title={
              !online ? "You're offline — showing downloaded videos" : "Show only downloaded videos"
            }
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition disabled:opacity-70 ${
              offlineOnly
                ? "bg-emerald-600 text-white hover:bg-emerald-700"
                : "bg-secondary text-secondary-foreground hover:bg-accent"
            }`}
          >
            <Download className="h-4 w-4" />
            Offline
            {usage.count > 0 && (
              <span
                className={`rounded-full px-1.5 text-[11px] ${
                  offlineOnly ? "bg-white/25" : "bg-background/70"
                }`}
              >
                {usage.count}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Offline banner — mirrors the Lite mode banner on the feed. */}
      {!online && (
        <div className="mt-2 flex items-center gap-2 rounded-lg bg-amber-500/15 px-3 py-2 text-[13px] font-semibold text-amber-700 dark:text-amber-400">
          <WifiOff className="h-4 w-4 shrink-0" />
          Offline mode — showing downloaded videos
        </div>
      )}

      {offlineOnly ? (
        <>
          {/* Storage meter: "Offline storage: 200MB / 500MB" with Delete. */}
          <div className="mt-3 rounded-xl border bg-card p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="truncate">
                  Offline storage: {formatStorage(usage.used)} / {formatStorage(usage.max)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => void deleteAll()}
                disabled={usage.count === 0}
                className="flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 text-[13px] font-semibold text-secondary-foreground transition hover:bg-destructive hover:text-destructive-foreground disabled:opacity-40 disabled:hover:bg-secondary disabled:hover:text-secondary-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete
              </button>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
              <div
                className={`h-full rounded-full transition-all ${
                  usedPct >= 90 ? "bg-destructive" : "bg-emerald-600"
                }`}
                style={{ width: `${usedPct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {usage.count === 0
                ? "No downloads yet. Tap Download on any video to watch it without internet."
                : `${usage.count} video${usage.count === 1 ? "" : "s"} available offline`}
            </p>
          </div>

          {offlineVideos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
                <Download className="h-6 w-6" />
              </div>
              <p className="mt-3 text-base font-semibold">No downloaded videos yet</p>
              <p className="mt-1 max-w-xs text-sm text-muted-foreground">
                Tap the Download button on any video. It'll show up here and play with zero signal.
              </p>
              <button
                type="button"
                onClick={() => setOfflineOnly(false)}
                className="mt-4 rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground hover:bg-accent"
              >
                Browse videos
              </button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
              {offlineVideos.map((item) => (
                <OfflineVideoCard key={item.video_id} item={item} onDelete={deleteOne} />
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          {error && (
            <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}

          {loading ? (
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

          {videos.length > 0 && (
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
        </>
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

/**
 * One downloaded video in the Offline grid.
 *
 * Shows a green "Downloaded ✓" badge, the saved size, and an X that deletes the
 * bytes from Cache Storage so the space is freed immediately.
 */
function OfflineVideoCard({
  item,
  onDelete,
}: {
  item: OfflineVideoMeta;
  onDelete: (id: string) => Promise<void>;
}) {
  const [thumb, setThumb] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    if (!item.thumbnail) return;
    // Plain URLs work offline; `storage:` refs need a signed URL, so only try
    // to resolve those when there is a connection.
    if (/^https?:/i.test(item.thumbnail)) {
      setThumb(item.thumbnail);
      return;
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;
    void resolveFullVideoUrl(item.thumbnail).then((u) => {
      if (alive && u) setThumb(u);
    });
    return () => {
      alive = false;
    };
  }, [item.thumbnail]);

  const handleDelete = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (deleting) return;
    setDeleting(true);
    try {
      await onDelete(item.video_id);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="group relative min-w-0">
      <button
        type="button"
        onClick={(event) => void handleDelete(event)}
        disabled={deleting}
        aria-label={`Delete download of ${item.title}`}
        title="Delete download"
        className="absolute right-1.5 top-1.5 z-10 flex size-8 items-center justify-center rounded-full bg-black/75 text-white shadow-sm backdrop-blur transition hover:bg-destructive disabled:opacity-60"
      >
        {deleting ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
      </button>

      <Link
        to="/watch/$id"
        params={{ id: item.video_id }}
        className="block min-w-0 focus-visible:outline-none"
        aria-label={`${item.title} by ${item.username} (downloaded)`}
      >
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
          {thumb ? (
            <img
              src={thumb}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-secondary text-muted-foreground">
              <Play className="h-8 w-8" />
            </div>
          )}

          {item.duration > 0 && (
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/80 px-1 py-0.5 text-[11px] font-semibold leading-none text-white tabular-nums">
              {formatDuration(item.duration)}
            </span>
          )}

          <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-semibold leading-none text-white">
            <CheckCircle2 className="size-3" />
            Downloaded
          </span>
        </div>

        <div className="mt-2 min-w-0">
          <h3 className="line-clamp-2 text-[13px] font-semibold leading-snug text-foreground">
            {item.title}
          </h3>
          <p className="mt-1 truncate text-[12px] text-muted-foreground">@{item.username}</p>
          <p className="truncate text-[12px] text-muted-foreground">
            {formatBytes(item.size)} · {timeAgo(new Date(item.downloaded_at).toISOString())}
          </p>
        </div>
      </Link>
    </div>
  );
}
