import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, ArrowLeft, Search, Upload, WifiOff } from "lucide-react";
import { FullVideoCard } from "@/components/FullVideoCard";
import { EditFullVideoDialog } from "@/components/EditFullVideoDialog";
import { YouTubeVideoCard } from "@/components/YouTubeVideoCard";
import { YouTubeEmbed } from "@/components/YouTubeEmbed";
import { useAuth } from "@/hooks/useAuth";
import { hasOfflineAccess, offlinePlan } from "@/lib/subscriptions";
import { useTrial } from "@/lib/trial";
import { FULL_VIDEO_CATEGORIES, listFullVideos, type FullVideo } from "@/lib/fullVideos";
import { listSavedFullVideos, onOfflineChange } from "@/lib/offline";
import { searchYouTubeVideos, type YouTubeVideo } from "@/lib/youtube";

const PAGE_SIZE = 12;
type VideosSource = "coolerup" | "youtube";

export const Route = createFileRoute("/videos")({
  head: () => ({ meta: [
    { title: "Videos — Coolerup" },
    { name: "description", content: "Watch full-length videos on Coolerup — music, gaming, comedy and more." },
    { property: "og:title", content: "Videos — Coolerup" },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  component: VideosPage,
});

function VideosPage() {
  const auth = useAuth();
  const offlineUnlocked = hasOfflineAccess(auth.handle);
  const trial = useTrial(auth.handle, offlinePlan().id);
  const navigate = useNavigate();
  const [category, setCategory] = useState("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [videos, setVideos] = useState<FullVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [youtubeError, setYoutubeError] = useState<string | null>(null);
  const [youtubeVideos, setYoutubeVideos] = useState<YouTubeVideo[]>([]);
  const [youtubeLoading, setYoutubeLoading] = useState(false);
  const [selectedYoutube, setSelectedYoutube] = useState<YouTubeVideo | null>(null);
  const [source, setSource] = useState<VideosSource>("coolerup");
  const [editing, setEditing] = useState<FullVideo | null>(null);
  const [offlineOnly, setOfflineOnly] = useState(false);
  const [savedVideos, setSavedVideos] = useState<FullVideo[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const requestRef = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(async () => {
    if (offlineOnly) return;
    const token = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const page = await listFullVideos({ category, search, limit: PAGE_SIZE, offset: 0, viewerId: auth.user?.id ?? null });
      if (token !== requestRef.current) return;
      setVideos(page);
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

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!search || offlineOnly) {
      setYoutubeVideos([]);
      setYoutubeError(null);
      setYoutubeLoading(false);
      return;
    }
    const controller = new AbortController();
    let alive = true;
    setYoutubeLoading(true);
    setYoutubeError(null);
    void searchYouTubeVideos(search, controller.signal)
      .then((results) => { if (alive) setYoutubeVideos(results); })
      .catch((err: unknown) => {
        if (alive && !(err instanceof DOMException && err.name === "AbortError")) {
          setYoutubeError(err instanceof Error ? err.message : "Could not load YouTube videos.");
          setYoutubeVideos([]);
        }
      })
      .finally(() => { if (alive) setYoutubeLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [search, offlineOnly]);

  useEffect(() => {
    if (!offlineOnly) return;
    let alive = true;
    const refresh = () => {
      setSavedLoading(true);
      void listSavedFullVideos().then((rows) => { if (alive) setSavedVideos(rows.map((row) => row.video)); })
        .catch(() => { if (alive) setSavedVideos([]); })
        .finally(() => { if (alive) setSavedLoading(false); });
    };
    refresh();
    const off = onOfflineChange(refresh);
    return () => { alive = false; off(); };
  }, [offlineOnly]);

  const loadMore = useCallback(async () => {
    if (offlineOnly || loadingMore || loading || !hasMore) return;
    const token = requestRef.current;
    setLoadingMore(true);
    try {
      const page = await listFullVideos({ category, search, limit: PAGE_SIZE, offset: videos.length, viewerId: auth.user?.id ?? null });
      if (token !== requestRef.current) return;
      setVideos((previous) => {
        const seen = new Set(previous.map((video) => video.id));
        return [...previous, ...page.filter((video) => !seen.has(video.id))];
      });
      setHasMore(page.length === PAGE_SIZE);
    } catch { /* Scrolling to the sentinel retries. */ }
    finally { if (token === requestRef.current) setLoadingMore(false); }
  }, [offlineOnly, loadingMore, loading, hasMore, videos.length, category, search, auth.user?.id]);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || offlineOnly || source !== "coolerup") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadMore();
    }, { rootMargin: "600px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loadMore, offlineOnly, source]);

  const startUpload = () => {
    if (!auth.user) { void auth.signIn(); return; }
    void navigate({ to: "/upload-full" });
  };
  const combinedSearch = Boolean(search) && source === "coolerup" && !offlineOnly;
  const shownYouTube = source === "youtube" ? youtubeVideos : combinedSearch ? youtubeVideos : [];

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-24 pt-3">
      <div className="sticky top-0 z-20 -mx-3 bg-background/95 px-3 pb-2 pt-1 backdrop-blur">
        <form onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); }} className="flex items-center gap-2">
          <Link to="/" aria-label="Back to feed" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground hover:bg-accent"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border bg-card px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search full videos" aria-label="Search full videos on Coolerup and YouTube" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          {source === "coolerup" && <button type="button" onClick={startUpload} aria-label="Upload a full video" className="flex shrink-0 items-center gap-1 rounded-full create-pink px-3 py-2 text-sm font-semibold"><Upload className="h-4 w-4" /><span className="hidden sm:inline">Upload</span></button>}
        </form>
        <div role="tablist" aria-label="Video source" className="mt-3 flex gap-2">
          {([ ["coolerup", "Coolerup"], ["youtube", "YouTube"] ] as const).map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={source === key} onClick={() => setSource(key)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${source === key ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}>{label}</button>
          ))}
        </div>
        {source === "coolerup" && !offlineOnly && <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1 no-scrollbar">
          {FULL_VIDEO_CATEGORIES.map((item) => <button key={item} type="button" onClick={() => setCategory(item)} aria-pressed={category === item} className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition ${category === item ? "bg-foreground text-background" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}>{item}</button>)}
          <button type="button" onClick={() => setOfflineOnly((value) => !value)} aria-pressed={offlineOnly} title="Show videos downloaded for offline viewing" className={`flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium ${offlineOnly ? "bg-emerald-600 text-white" : "bg-secondary text-secondary-foreground hover:bg-accent"}`}><WifiOff className="h-3.5 w-3.5" />Offline</button>
        </div>}
      </div>

      {error && source === "coolerup" && <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
      {youtubeError && (source === "youtube" || combinedSearch) && <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{youtubeError}</p>}

      {source === "youtube" ? (
        !search ? <div className="py-20 text-center"><p className="font-semibold">Search YouTube videos</p><p className="mt-1 text-sm text-muted-foreground">Enter a search above to browse YouTube videos.</p></div>
          : youtubeLoading ? <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
            : youtubeVideos.length ? <div className="mt-4 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">{youtubeVideos.map((video) => <YouTubeVideoCard key={video.id} video={video} onSelect={setSelectedYoutube} />)}</div>
              : !youtubeError && <p className="py-20 text-center text-sm text-muted-foreground">No YouTube videos found. Try another search.</p>
      ) : offlineOnly ? (
        savedLoading ? <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
          : savedVideos.length === 0 ? <div className="flex flex-col items-center justify-center py-20 text-center"><WifiOff className="h-8 w-8 text-muted-foreground" /><p className="mt-3 font-semibold">Nothing saved offline yet</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">{offlineUnlocked ? "Open any video and tap Download on the watch page to keep it available without a connection." : trial.used ? `Your free trial has ended. Offline downloads are part of ${offlinePlan().label} and VIP.` : `Start a free one-hour trial from any video's watch page, or upgrade to ${offlinePlan().label} to save videos offline.`}</p><button type="button" onClick={() => setOfflineOnly(false)} className="mt-4 rounded-full bg-secondary px-4 py-2 text-sm font-semibold">Browse all videos</button></div>
            : <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">{savedVideos.map((video) => <FullVideoCard key={video.id} video={video} />)}</div>
      ) : loading ? <div className="flex justify-center py-20 text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin" /></div>
        : videos.length === 0 && !shownYouTube.length ? <div className="flex flex-col items-center justify-center py-20 text-center"><p className="text-base font-semibold">No videos here yet</p><p className="mt-1 max-w-xs text-sm text-muted-foreground">{search ? `Nothing matched "${search}". Try a different search.` : "Be the first to upload a full-length video to this category."}</p><button type="button" onClick={startUpload} className="mt-4 rounded-full create-pink px-4 py-2 text-sm font-semibold">Upload a video</button></div>
          : <>
            {combinedSearch && shownYouTube.length > 0 && <h2 className="mt-4 text-sm font-semibold">Search results</h2>}
            <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
              {videos.map((video) => <FullVideoCard key={`coolerup-${video.id}`} video={video} onEdit={auth.user && video.user_id === auth.user.id ? setEditing : undefined} />)}
              {shownYouTube.map((video) => <YouTubeVideoCard key={`youtube-${video.id}`} video={video} onSelect={setSelectedYoutube} />)}
            </div>
            {combinedSearch && youtubeLoading && <div className="flex justify-center py-5 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /><span className="sr-only">Loading YouTube results</span></div>}
            {combinedSearch && youtubeError && <p className="mt-3 text-sm text-muted-foreground">YouTube results are temporarily unavailable.</p>}
          </>
      }

      {source === "coolerup" && !offlineOnly && videos.length > 0 && <div className="mt-6 flex flex-col items-center gap-3"><div ref={sentinelRef} aria-hidden className="h-px w-full" />{loadingMore && <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Loading more…</div>}{hasMore && !loadingMore && <button type="button" onClick={() => void loadMore()} className="rounded-full bg-secondary px-4 py-2 text-sm font-semibold">Load more</button>}{!hasMore && <p className="py-2 text-[13px] text-muted-foreground">That's everything for now.</p>}<Link to="/" className="text-sm text-muted-foreground underline">Back to the feed</Link></div>}

      {editing && auth.user && <EditFullVideoDialog video={editing} userId={auth.user.id} open onClose={() => setEditing(null)} onSaved={(next) => setVideos((previous) => previous.map((video) => video.id === next.id ? next : video))} onDeleted={(id) => setVideos((previous) => previous.filter((video) => video.id !== id))} />}
      {selectedYoutube && <YouTubeEmbed video={selectedYoutube} onClose={() => setSelectedYoutube(null)} />}
    </div>
  );
}
