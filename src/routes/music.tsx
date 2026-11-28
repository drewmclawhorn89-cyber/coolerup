import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  Download,
  FileAudio,
  Flame,
  HardDriveDownload,
  Headphones,
  Heart,
  ImagePlus,
  Loader2,
  Lock,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  Trash2,
  Upload,
  WifiOff,
  Youtube,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { ListRowSkeleton } from "@/components/Skeletons";
import { SongCard, SongRow, SoundCover } from "@/components/SongCard";
import { RemoveDownloadButton, ReplaceAudioButton } from "@/components/DownloadButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { songPlayer, useSongPlayer, type PlayerTrack } from "@/lib/songPlayer";
import {
  canBackgroundPlay,
  setBackgroundPlayEnabled,
  useBackgroundPlay,
  YOUTUBE_BACKGROUND_WARNING,
} from "@/lib/backgroundPlay";
import {
  backgroundPlayPlan,
  hasBackgroundPlayAccess,
  hasMusicOfflineAccess,
  musicOfflinePlan,
} from "@/lib/subscriptions";
import { useTrial } from "@/lib/trial";
import {
  FULL_SONG_SECONDS,
  MUSIC_PAGE_SIZE,
  getAllSounds,
  getKnownDuration,
  getSavedSoundIds,
  getSavedSounds,
  getTopSounds,
  getTrendingSoundsThisWeek,
  isFullSong,
  isYouTubeSound,
  probeSoundDurations,
  saveSound,
  searchSoundsCatalog,
  soundAudioUrl,
  soundCoverGradient,
  unsaveSound,
  type Sound,
} from "@/lib/sounds";
import { addYouTubeSong, getYouTubeSongs, incrementSoundPlay } from "@/lib/youtubeSongs";
import {
  AUDIO_ACCEPT,
  COVER_ACCEPT,
  MAX_SONG_UPLOAD_MB,
  deleteUploadedSong,
  formatFileSize,
  getMyUploadedSongs,
  songTitleFromFileName,
  uploadSong,
  validateCoverFile,
  validateSongFile,
} from "@/lib/songUpload";
import {
  formatStorage,
  listSavedSongs,
  listStaleSongs,
  markSongPlayed,
  offlineSongUrl,
  offlineSongsSize,
  onOfflineSongsChange,
  removeStaleSongs,
  STALE_DAYS,
  type SavedSong,
} from "@/lib/offlineSongs";

export const Route = createFileRoute("/music")({
  component: MusicPage,
});

type MusicTab = "top" | "trending" | "mine" | "full" | "downloaded";

const TABS: { id: MusicTab; label: string }[] = [
  { id: "top", label: "Top Songs" },
  { id: "trending", label: "Trending" },
  { id: "mine", label: "Your Sounds" },
  { id: "full", label: "Full Songs" },
  { id: "downloaded", label: "Downloaded" },
];

function toTrack(sound: Sound, url: string): PlayerTrack {
  const youtube = isYouTubeSound(sound);
  return {
    soundId: sound.id,
    title: sound.title,
    artist: youtube ? sound.creator_username : `@${sound.creator_username}`,
    url,
    cover: soundCoverGradient(sound.id),
    source: youtube ? "youtube" : "own",
    youtubeUrl: sound.youtube_url ?? null,
    coverUrl: sound.cover_url ?? null,
  };
}

function MusicPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const player = useSongPlayer();

  const [tab, setTab] = useState<MusicTab>("top");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [all, setAll] = useState<Sound[]>([]);
  const [allHasMore, setAllHasMore] = useState(false);
  const [allOffset, setAllOffset] = useState(0);

  const [youtubeSongs, setYoutubeSongs] = useState<Sound[]>([]);
  const [youtubeHasMore, setYoutubeHasMore] = useState(false);
  const [youtubeLoadingMore, setYoutubeLoadingMore] = useState(false);

  const [top, setTop] = useState<Sound[]>([]);
  const [topHasMore, setTopHasMore] = useState(false);

  const [trending, setTrending] = useState<Sound[]>([]);
  const [trendingHasMore, setTrendingHasMore] = useState(false);

  const [saved, setSaved] = useState<Sound[]>([]);
  const [savedOffset, setSavedOffset] = useState(0);
  const [savedHasMore, setSavedHasMore] = useState(false);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  const [searchResults, setSearchResults] = useState<Sound[] | null>(null);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);

  const [loadedTabs, setLoadedTabs] = useState<Record<MusicTab, boolean>>({
    top: false,
    trending: false,
    mine: false,
    full: false,
    downloaded: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [probing, setProbing] = useState(false);
  const [durationVersion, setDurationVersion] = useState(0);
  const [addingYouTube, setAddingYouTube] = useState(false);
  /** "Upload a song" dialog. */
  const [uploadingSong, setUploadingSong] = useState(false);
  /** Songs this user uploaded directly (not from a video, not YouTube). */
  const [myUploads, setMyUploads] = useState<Sound[]>([]);
  /** Song queued for deletion (confirmation dialog). */
  const [deletingSong, setDeletingSong] = useState<Sound | null>(null);
  const [deleting, setDeleting] = useState(false);
  /** Songs stored in IndexedDB — these play with no signal at all. */
  const [downloadedSongs, setDownloadedSongs] = useState<SavedSong[]>([]);
  const [downloadBytes, setDownloadBytes] = useState(0);
  /** Downloaded songs untouched for 30 days — offered up for deletion. */
  const [staleSongs, setStaleSongs] = useState<SavedSong[]>([]);
  const listSentinelRef = useRef<HTMLDivElement | null>(null);

  // Offline music downloads are a VIP-only perk (plus the lifetime "all access"
  // grant). Pro keeps offline *videos*, but music is gated at VIP, so Pro, Plus
  // and free accounts all see the upgrade prompt here.
  const offlineUnlocked = hasMusicOfflineAccess(auth.handle);
  const offlineTrial = useTrial(auth.handle, musicOfflinePlan().id);

  // Initial load fetches only the Top Songs page (10 items) + saved IDs for heart icons.
  const loadTopTab = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [topSounds, ids] = await Promise.all([
        getTopSounds(MUSIC_PAGE_SIZE, 0),
        auth.user
          ? getSavedSoundIds().catch(() => new Set<string>())
          : Promise.resolve(new Set<string>()),
      ]);
      setTop(topSounds);
      setTopHasMore(topSounds.length === MUSIC_PAGE_SIZE);
      setSavedIds(ids);
      setLoadedTabs((prev) => ({ ...prev, top: true }));
    } catch {
      setError("Couldn't load songs. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    void loadTopTab();
  }, [loadTopTab]);

  // Reset user-scoped tabs when auth state changes.
  useEffect(() => {
    if (!auth.user) {
      setSaved([]);
      setSavedIds(new Set());
      setMyUploads([]);
      setSavedOffset(0);
      setSavedHasMore(false);
    }
    setLoadedTabs((prev) => ({ ...prev, mine: false }));
  }, [auth.user]);

  // Lazy-load Trending, Your Sounds, and Full Songs tabs only when tapped.
  const loadTabData = useCallback(
    async (target: MusicTab) => {
      if (target === "top" || target === "downloaded" || loadedTabs[target]) return;
      setLoading(true);
      setError("");
      try {
        if (target === "trending") {
          const [trendingSounds, youTube] = await Promise.all([
            getTrendingSoundsThisWeek(MUSIC_PAGE_SIZE, 0),
            getYouTubeSongs(MUSIC_PAGE_SIZE, 0).catch(() => [] as Sound[]),
          ]);
          setTrending(trendingSounds);
          setTrendingHasMore(trendingSounds.length === MUSIC_PAGE_SIZE);
          setYoutubeSongs(youTube);
          setYoutubeHasMore(youTube.length === MUSIC_PAGE_SIZE);
        } else if (target === "mine") {
          if (auth.user) {
            const [mine, uploads] = await Promise.all([
              getSavedSounds(MUSIC_PAGE_SIZE, 0),
              getMyUploadedSongs(MUSIC_PAGE_SIZE).catch(() => [] as Sound[]),
            ]);
            setSaved(mine);
            setSavedOffset(MUSIC_PAGE_SIZE);
            setSavedHasMore(mine.length === MUSIC_PAGE_SIZE);
            setMyUploads(uploads);
          } else {
            setSaved([]);
            setSavedOffset(0);
            setSavedHasMore(false);
            setMyUploads([]);
          }
        } else if (target === "full") {
          const firstPage = await getAllSounds(MUSIC_PAGE_SIZE, 0);
          setAll(firstPage);
          setAllOffset(MUSIC_PAGE_SIZE);
          setAllHasMore(firstPage.length === MUSIC_PAGE_SIZE);
          if (firstPage.length) {
            setProbing(true);
            void probeSoundDurations(firstPage, MUSIC_PAGE_SIZE)
              .catch(() => undefined)
              .finally(() => {
                setProbing(false);
                setDurationVersion((n) => n + 1);
              });
          }
        }
        setLoadedTabs((prev) => ({ ...prev, [target]: true }));
      } catch {
        setError("Couldn't load this tab. Check your connection and try again.");
      } finally {
        setLoading(false);
      }
    },
    [auth.user, loadedTabs],
  );

  useEffect(() => {
    if (debouncedQuery) return;
    void loadTabData(tab);
  }, [tab, debouncedQuery, loadTabData]);

  // Debounce Music search and query database 10 results at a time.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setDebouncedQuery("");
      setSearchResults(null);
      setSearchHasMore(false);
      setSearchLoading(false);
      return;
    }
    const timer = window.setTimeout(() => setDebouncedQuery(trimmed), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!debouncedQuery) return;
    let alive = true;
    setSearchLoading(true);
    void searchSoundsCatalog(debouncedQuery, MUSIC_PAGE_SIZE, 0)
      .then((rows) => {
        if (!alive) return;
        setSearchResults(rows);
        setSearchHasMore(rows.length === MUSIC_PAGE_SIZE);
      })
      .catch(() => {
        if (!alive) return;
        setSearchResults([]);
        setSearchHasMore(false);
      })
      .finally(() => {
        if (alive) setSearchLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [debouncedQuery]);

  /**
   * Keep the Downloaded tab in sync with IndexedDB. Loaded lazily when the
   * Downloaded tab is opened (or when offline downloads change).
   */
  const refreshDownloads = useCallback(async () => {
    try {
      const [songs, bytes, stale] = await Promise.all([
        listSavedSongs(),
        offlineSongsSize(),
        listStaleSongs(),
      ]);
      setDownloadedSongs(songs);
      setDownloadBytes(bytes);
      setStaleSongs(stale);
    } catch {
      /* private mode / storage disabled — the tab just stays empty */
    }
  }, []);

  useEffect(() => {
    if (tab !== "downloaded") return;
    void refreshDownloads();
    return onOfflineSongsChange(() => void refreshDownloads());
  }, [tab, refreshDownloads]);

  const loadMoreActive = useCallback(async () => {
    if (loading || loadingMore || searchLoading) return;
    if (debouncedQuery) {
      if (!searchHasMore || !searchResults) return;
      setLoadingMore(true);
      try {
        const next = await searchSoundsCatalog(
          debouncedQuery,
          MUSIC_PAGE_SIZE,
          searchResults.length,
        );
        setSearchResults((prev) => {
          const seen = new Set((prev ?? []).map((s) => s.id));
          return [...(prev ?? []), ...next.filter((s) => !seen.has(s.id))];
        });
        setSearchHasMore(next.length === MUSIC_PAGE_SIZE);
      } finally {
        setLoadingMore(false);
      }
      return;
    }

    if (tab === "top" && topHasMore) {
      setLoadingMore(true);
      try {
        const next = await getTopSounds(MUSIC_PAGE_SIZE, top.length);
        setTop((prev) => {
          const seen = new Set(prev.map((s) => s.id));
          return [...prev, ...next.filter((s) => !seen.has(s.id))];
        });
        setTopHasMore(next.length === MUSIC_PAGE_SIZE);
      } finally {
        setLoadingMore(false);
      }
    } else if (tab === "trending" && trendingHasMore) {
      setLoadingMore(true);
      try {
        const next = await getTrendingSoundsThisWeek(MUSIC_PAGE_SIZE, trending.length);
        setTrending((prev) => {
          const seen = new Set(prev.map((s) => s.id));
          return [...prev, ...next.filter((s) => !seen.has(s.id))];
        });
        setTrendingHasMore(next.length === MUSIC_PAGE_SIZE);
      } finally {
        setLoadingMore(false);
      }
    } else if (tab === "mine" && savedHasMore && auth.user) {
      setLoadingMore(true);
      try {
        const next = await getSavedSounds(MUSIC_PAGE_SIZE, savedOffset);
        setSaved((prev) => {
          const seen = new Set(prev.map((s) => s.id));
          return [...prev, ...next.filter((s) => !seen.has(s.id))];
        });
        setSavedOffset((o) => o + MUSIC_PAGE_SIZE);
        setSavedHasMore(next.length === MUSIC_PAGE_SIZE);
      } finally {
        setLoadingMore(false);
      }
    } else if (tab === "full" && allHasMore) {
      setLoadingMore(true);
      try {
        const next = await getAllSounds(MUSIC_PAGE_SIZE, allOffset);
        setAll((prev) => {
          const seen = new Set(prev.map((s) => s.id));
          return [...prev, ...next.filter((s) => !seen.has(s.id))];
        });
        setAllOffset((o) => o + MUSIC_PAGE_SIZE);
        setAllHasMore(next.length === MUSIC_PAGE_SIZE);
        if (next.length) {
          setProbing(true);
          void probeSoundDurations(next, MUSIC_PAGE_SIZE)
            .catch(() => undefined)
            .finally(() => {
              setProbing(false);
              setDurationVersion((n) => n + 1);
            });
        }
      } finally {
        setLoadingMore(false);
      }
    }
  }, [
    allHasMore,
    allOffset,
    auth.user,
    debouncedQuery,
    loading,
    loadingMore,
    savedHasMore,
    savedOffset,
    searchHasMore,
    searchLoading,
    searchResults,
    tab,
    top.length,
    topHasMore,
    trending.length,
    trendingHasMore,
  ]);

  const activeHasMore = debouncedQuery
    ? searchHasMore
    : tab === "top"
      ? topHasMore
      : tab === "trending"
        ? trendingHasMore
        : tab === "mine"
          ? savedHasMore
          : tab === "full"
            ? allHasMore
            : false;

  useEffect(() => {
    const node = listSentinelRef.current;
    if (!node || !activeHasMore || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMoreActive();
      },
      { rootMargin: "400px 0px" },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [activeHasMore, loadMoreActive]);

  const loadMoreYouTube = useCallback(async () => {
    if (youtubeLoadingMore || !youtubeHasMore) return;
    setYoutubeLoadingMore(true);
    try {
      const next = await getYouTubeSongs(MUSIC_PAGE_SIZE, youtubeSongs.length);
      setYoutubeSongs((prev) => {
        const seen = new Set(prev.map((s) => s.id));
        return [...prev, ...next.filter((s) => !seen.has(s.id))];
      });
      setYoutubeHasMore(next.length === MUSIC_PAGE_SIZE);
    } finally {
      setYoutubeLoadingMore(false);
    }
  }, [youtubeHasMore, youtubeLoadingMore, youtubeSongs.length]);

  const fullSongs = useMemo(() => {
    // Song lengths live in a module-level cache, not in React state, so
    // `durationVersion` is the reactive signal that probing has finished.
    void durationVersion;
    const measured = all.filter((s) => isFullSong(s.id));
    if (measured.length) return measured;
    // Nothing measured yet (or every file is short) — show the longest known.
    const withKnown = [...all]
      .filter((s) => {
        const d = getKnownDuration(s.id);
        return typeof d === "number" && d > 0;
      })
      .sort((a, b) => (getKnownDuration(b.id) ?? 0) - (getKnownDuration(a.id) ?? 0));
    return withKnown.length ? withKnown : all;
  }, [all, durationVersion]);

  const toggleSave = useCallback(
    async (sound: Sound) => {
      if (!auth.user) {
        toast.error("Sign in to save sounds.");
        return;
      }
      const next = !savedIds.has(sound.id);
      setSavedIds((prev) => {
        const n = new Set(prev);
        if (next) n.add(sound.id);
        else n.delete(sound.id);
        return n;
      });
      if (next) setSaved((prev) => [sound, ...prev.filter((s) => s.id !== sound.id)]);
      else setSaved((prev) => prev.filter((s) => s.id !== sound.id));

      const ok = next ? await saveSound(sound.id) : await unsaveSound(sound.id);
      if (!ok) {
        toast.error("Couldn't update Your Sounds.");
        void loadTopTab();
      }
    },
    [auth.user, savedIds, loadTopTab],
  );

  /** Delete one of the user's own uploads after they confirm. */
  const confirmDelete = useCallback(async () => {
    if (!deletingSong || deleting) return;
    setDeleting(true);
    const id = deletingSong.id;
    try {
      await deleteUploadedSong(deletingSong);
      setMyUploads((prev) => prev.filter((s) => s.id !== id));
      setAll((prev) => prev.filter((s) => s.id !== id));
      setSaved((prev) => prev.filter((s) => s.id !== id));
      setSavedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      toast.success("Song deleted.");
      setDeletingSong(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't delete that song.");
    } finally {
      setDeleting(false);
    }
  }, [deletingSong, deleting]);

  /**
   * Play a song and queue up the rest of the list behind it.
   *
   * Only the tapped song's URL is resolved before playback starts — resolving
   * 40 signed URLs up front makes the tap feel broken on a phone.
   */
  /**
   * Resolve a playable URL for a song.
   *
   * The downloaded copy is checked FIRST: with 0 signal the signed Supabase URL
   * can't be created, but the blob in IndexedDB still plays. That is the whole
   * point of the Downloaded tab.
   */
  const resolvePlayableUrl = useCallback(
    async (sound: Sound): Promise<string> => {
      // Offline copies only play for VIP. Without the perk we skip IndexedDB
      // entirely and stream, so a lapsed subscription can't keep using the
      // downloaded library.
      if (offlineUnlocked) {
        const local = await offlineSongUrl(sound.id).catch(() => "");
        if (local) return local;
      }
      return soundAudioUrl(sound);
    },
    [offlineUnlocked],
  );

  const openSong = useCallback(
    async (sound: Sound, list: Sound[]) => {
      // YouTube songs stream from YouTube's embed player — unless the user
      // attached an audio file, in which case the local copy plays offline.
      if (isYouTubeSound(sound)) {
        const local = offlineUnlocked ? await offlineSongUrl(sound.id).catch(() => "") : "";
        if (local) {
          const track = { ...toTrack(sound, local), source: "own" as const };
          songPlayer.playQueue([track], 0);
          void markSongPlayed(sound.id);
          return;
        }
        // Stream through the shared player so YouTube songs keep playing while
        // the user moves around the app. The hidden IFrame lives outside this
        // route, so leaving the Music tab no longer kills playback.
        const ytList = list.filter(isYouTubeSound);
        const queue = (ytList.length ? ytList : [sound]).map((s) => toTrack(s, ""));
        const at = Math.max(
          0,
          queue.findIndex((t) => t.soundId === sound.id),
        );
        songPlayer.playQueue(queue, at);
        void incrementSoundPlay(sound.id);
        return;
      }
      try {
        const url = await resolvePlayableUrl(sound);
        if (!url) {
          toast.error(
            downloadedSongs.length
              ? "That song isn't downloaded, so it needs a connection."
              : "That sound isn't playable right now.",
          );
          return;
        }
        const track = toTrack(sound, url);
        songPlayer.playQueue([track], 0);
        // Reset the 30-day "delete to save space" clock for the tapped song only.
        void markSongPlayed(sound.id);

        // Fill the queue in the background so Next/Prev work.
        const rest = list.filter((s) => s.id !== sound.id).slice(0, 24);
        const resolved: PlayerTrack[] = [];
        for (let i = 0; i < rest.length; i += 6) {
          const batch = await Promise.all(
            rest.slice(i, i + 6).map(async (s) => {
              const u = await resolvePlayableUrl(s).catch(() => "");
              return u ? toTrack(s, u) : null;
            }),
          );
          for (const t of batch) if (t) resolved.push(t);
        }
        const at = Math.max(
          0,
          list.findIndex((s) => s.id === sound.id),
        );
        const queue = [...resolved.slice(0, at), track, ...resolved.slice(at)];
        songPlayer.replaceQueue(queue);
      } catch {
        toast.error("Couldn't play that song.");
      }
    },
    [resolvePlayableUrl, downloadedSongs.length, offlineUnlocked],
  );

  const nowPlayingId = player.queue[player.index]?.soundId ?? "";
  const nowPlayingTrack = player.queue[player.index] ?? null;
  const backgroundPlay = useBackgroundPlay();
  // Background play is a VIP perk; non-VIP listeners get an upsell instead of
  // a switch that silently does nothing.
  const backgroundUnlocked = hasBackgroundPlayAccess(auth.handle);

  const renderList = (sounds: Sound[], empty: string) => {
    if (!sounds.length) return <p className="px-1 py-6 text-sm text-muted-foreground">{empty}</p>;
    return (
      <div className="space-y-0.5">
        {sounds.map((s, i) => (
          <SongRow
            key={s.id}
            sound={s}
            index={i}
            playing={nowPlayingId === s.id && player.playing}
            saved={savedIds.has(s.id)}
            onToggleSave={() => void toggleSave(s)}
            onOpen={() => void openSong(s, sounds)}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-dvh bg-background pb-[calc(8rem+env(safe-area-inset-bottom))]">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur">
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
            <Music2 className="h-5 w-5 text-primary" /> Music
          </h1>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                if (!auth.user) {
                  void auth.signIn();
                  return;
                }
                setUploadingSong(true);
              }}
              className="flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:opacity-90"
            >
              <Upload className="h-3.5 w-3.5" /> Upload
            </button>
            <button
              type="button"
              onClick={() => {
                if (!auth.user) {
                  void auth.signIn();
                  return;
                }
                setAddingYouTube(true);
              }}
              aria-label="Add YouTube song"
              title="Add YouTube song"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-red-600 text-white hover:bg-red-500"
            >
              <Youtube className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="mx-auto max-w-2xl px-4 pb-2">
          <div className="flex items-center gap-2 rounded-full bg-white/5 px-3">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search songs..."
              aria-label="Search songs"
              className="h-10 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Clear search">
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Inner tabs */}
        <div className="no-scrollbar mx-auto flex max-w-2xl gap-4 overflow-x-auto px-4 pb-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`shrink-0 border-b-2 pb-1.5 text-[13px] font-semibold ${
                tab === t.id
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              <span className="inline-flex items-center gap-1">
                {t.label}
                {t.id === "downloaded" && !offlineUnlocked && (
                  <Lock
                    className="h-3 w-3 text-muted-foreground"
                    aria-label="Subscription required"
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Background Play — one tap to keep the song going when the phone is
          locked or the user jumps to another app. */}
      <div className="mx-auto max-w-2xl px-4 pt-3">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2.5">
          <Headphones
            className={`h-4 w-4 shrink-0 ${backgroundPlay ? "text-primary" : "text-muted-foreground"}`}
          />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-[13px] font-bold">
              Background Play
              {!backgroundUnlocked && (
                <Lock className="h-3 w-3 text-muted-foreground" aria-label="VIP required" />
              )}
            </p>
            <p className="truncate text-[11px] text-muted-foreground">
              {!backgroundUnlocked
                ? `VIP perk — upgrade to keep music playing when you leave the app.`
                : backgroundPlay
                  ? "Keeps playing when you switch tabs, lock your phone, or open another app."
                  : "Music stops when you leave the app."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (!backgroundUnlocked) {
                toast.error(`Background play is a ${backgroundPlayPlan().label} perk.`, {
                  action: {
                    label: "Upgrade",
                    onClick: () =>
                      void navigate({ to: "/settings", search: { subscriptions: true } }),
                  },
                });
                return;
              }
              const next = !backgroundPlay;
              setBackgroundPlayEnabled(next);
              toast.success(next ? "Background Play ON" : "Background Play OFF");
            }}
            aria-pressed={backgroundPlay}
            aria-label="Toggle Background Play"
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${
              backgroundPlay
                ? "bg-primary text-primary-foreground"
                : "border border-white/15 text-muted-foreground"
            }`}
          >
            {backgroundUnlocked ? (backgroundPlay ? "ON" : "OFF") : "VIP"}
          </button>
        </div>
        {!backgroundUnlocked && (
          <button
            type="button"
            onClick={() => void navigate({ to: "/settings", search: { subscriptions: true } })}
            className="mt-2 w-full rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground"
          >
            Unlock Background Play with {backgroundPlayPlan().label} · $
            {backgroundPlayPlan().price.toFixed(2)}/mo
          </button>
        )}
        {nowPlayingTrack && !canBackgroundPlay(nowPlayingTrack) && (
          <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p className="text-[11px] leading-snug text-amber-200">{YOUTUBE_BACKGROUND_WARNING}</p>
          </div>
        )}
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4">
        {(loading && !debouncedQuery) || (debouncedQuery && searchLoading) ? (
          <ListRowSkeleton count={5} />
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => {
                if (tab === "top") void loadTopTab();
                else {
                  setLoadedTabs((prev) => ({ ...prev, [tab]: false }));
                }
              }}
              className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Try again
            </button>
          </div>
        ) : debouncedQuery ? (
          <section>
            <h2 className="mb-2 px-1 text-sm font-bold">
              Results for “{debouncedQuery}”{" "}
              <span className="text-muted-foreground">{searchResults?.length ?? 0}</span>
            </h2>
            {renderList(searchResults ?? [], "No songs match that search.")}
          </section>
        ) : tab === "top" ? (
          <section>
            <div className="mb-2 flex items-center gap-1.5 px-1">
              <Flame className="h-4 w-4 text-orange-500" />
              <h2 className="text-sm font-bold">Top Songs</h2>
              <span className="text-[11px] text-muted-foreground">{top.length}</span>
            </div>
            {top.length > 0 && (
              <div className="no-scrollbar -mx-4 mb-4 flex gap-3 overflow-x-auto px-4 pb-1">
                {top.slice(0, MUSIC_PAGE_SIZE).map((s) => (
                  <SongCard
                    key={s.id}
                    sound={s}
                    playing={nowPlayingId === s.id && player.playing}
                    saved={savedIds.has(s.id)}
                    onToggleSave={() => void toggleSave(s)}
                    onOpen={() => void openSong(s, top)}
                  />
                ))}
              </div>
            )}
            {renderList(top, "No songs yet.")}
          </section>
        ) : tab === "trending" ? (
          <section>
            <div className="mb-2 flex items-center gap-1.5 px-1">
              <Sparkles className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold">Trending Sounds</h2>
            </div>
            {renderList(trending, "Nothing trending this week.")}
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <Youtube className="h-4 w-4 text-red-600" />
                <h2 className="text-sm font-bold">YouTube Songs</h2>
                <span className="text-[11px] text-muted-foreground">{youtubeSongs.length}</span>
              </div>
              {renderList(youtubeSongs, "No YouTube songs yet.")}
              {youtubeHasMore && (
                <button
                  type="button"
                  onClick={() => void loadMoreYouTube()}
                  disabled={youtubeLoadingMore}
                  className="mt-2 rounded-full bg-secondary px-3 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-accent disabled:opacity-50"
                >
                  {youtubeLoadingMore ? "Loading…" : "Load more YouTube songs"}
                </button>
              )}
            </div>
          </section>
        ) : tab === "mine" ? (
          <section>
            <div className="mb-2 flex items-center gap-1.5 px-1">
              <Upload className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold">Your Uploads</h2>
              <span className="text-[11px] text-muted-foreground">{myUploads.length}</span>
              <button
                type="button"
                onClick={() => {
                  if (!auth.user) {
                    void auth.signIn();
                    return;
                  }
                  setUploadingSong(true);
                }}
                className="ml-auto flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 text-[11px] font-bold text-muted-foreground hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> Upload
              </button>
            </div>
            {myUploads.length ? (
              <div className="space-y-0.5">
                {myUploads.map((s, i) => (
                  <SongRow
                    key={s.id}
                    sound={s}
                    index={i}
                    playing={nowPlayingId === s.id && player.playing}
                    saved={savedIds.has(s.id)}
                    onToggleSave={() => void toggleSave(s)}
                    onOpen={() => void openSong(s, myUploads)}
                    onDelete={() => setDeletingSong(s)}
                  />
                ))}
              </div>
            ) : (
              <p className="px-1 py-4 text-sm text-muted-foreground">
                {auth.user
                  ? `No uploads yet. Tap Upload to add an MP3, M4A, WAV, OGG, OPUS or FLAC (up to ${MAX_SONG_UPLOAD_MB} MB).`
                  : "Sign in to upload your own songs."}
              </p>
            )}

            <div className="mb-2 mt-6 flex items-center gap-1.5 px-1">
              <Heart className="h-4 w-4 text-red-500" />
              <h2 className="text-sm font-bold">Saved Songs</h2>
              <span className="text-[11px] text-muted-foreground">{saved.length}</span>
            </div>
            {renderList(
              saved,
              auth.user
                ? "No saved sounds yet. Tap the heart on any song."
                : "Sign in to save sounds to Your Sounds.",
            )}
          </section>
        ) : tab === "full" ? (
          <section>
            {probing && !fullSongs.length ? (
              <ListRowSkeleton count={4} />
            ) : (
              renderList(
                fullSongs,
                "No full-length songs yet. Sounds are added when people upload videos.",
              )
            )}
            <div className="mt-4 flex gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-500" />
              <p className="text-xs leading-relaxed text-amber-200/90">
                Only sounds already in Coolerup can be used here. Don't upload a copyrighted song
                from YouTube or Spotify — use your own sound or a royalty-free one, or the account
                can be banned.
              </p>
            </div>
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">
              A song is marked “Full song” once its file runs longer than {FULL_SONG_SECONDS}s.
              Shorter ones are 15-second clips.
            </p>
          </section>
        ) : tab === "downloaded" && !offlineUnlocked ? (
          <section className="py-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
              <Lock className="h-6 w-6 text-primary" />
            </div>
            <h2 className="mt-4 text-base font-bold">Offline music is a VIP perk</h2>
            <p className="mx-auto mt-1 max-w-xs text-sm leading-relaxed text-muted-foreground">
              {offlineTrial.used
                ? `Your free trial has ended. Offline music downloads are a ${musicOfflinePlan().label} perk — Pro and Plus do not include them.`
                : `Try offline music free for one hour, or subscribe to ${musicOfflinePlan().label} to keep songs on your phone and play them with 0 signal.`}
            </p>
            <div className="mt-5 flex flex-col items-center gap-2">
              {!offlineTrial.used && (
                <Button
                  className="w-full max-w-xs"
                  variant="secondary"
                  onClick={() => {
                    if (!auth.user) {
                      auth.signIn();
                      return;
                    }
                    offlineTrial.start(musicOfflinePlan().id);
                    toast.success("1-hour free trial started");
                  }}
                >
                  Start 1-hour free trial
                </Button>
              )}
              <Button
                className="w-full max-w-xs"
                onClick={() => {
                  if (!auth.user) {
                    auth.signIn();
                    return;
                  }
                  void navigate({ to: "/settings", search: { subscriptions: true } });
                }}
              >
                {`Subscribe to ${musicOfflinePlan().label} — $${musicOfflinePlan().price.toFixed(2)}/mo`}
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-muted-foreground">
              Already subscribed? Refresh after your payment confirms.
            </p>
          </section>
        ) : (
          <DownloadedTab
            songs={downloadedSongs}
            bytes={downloadBytes}
            stale={staleSongs}
            playingId={nowPlayingId}
            isPlaying={player.playing}
            onOpen={(song) =>
              void openSong(
                song,
                downloadedSongs.map((d) => d.sound),
              )
            }
            onChanged={() => void refreshDownloads()}
          />
        )}

        {activeHasMore && (
          <div className="mt-4 flex flex-col items-center gap-2">
            <div ref={listSentinelRef} aria-hidden="true" className="h-px w-full" />
            {loadingMore ? (
              <div className="w-full">
                <ListRowSkeleton count={2} />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => void loadMoreActive()}
                className="rounded-full bg-secondary px-4 py-1.5 text-xs font-semibold text-secondary-foreground hover:bg-accent"
              >
                Load 10 more
              </button>
            )}
          </div>
        )}
      </div>

      {uploadingSong && (
        <UploadSongDialog
          open={uploadingSong}
          onClose={() => setUploadingSong(false)}
          onUploaded={(song) => {
            setMyUploads((prev) => [song, ...prev.filter((s) => s.id !== song.id)]);
            setAll((prev) => [song, ...prev.filter((s) => s.id !== song.id)]);
            toast.success("Song uploaded to Music.");
          }}
        />
      )}

      {deletingSong && (
        <Dialog
          open={Boolean(deletingSong)}
          onOpenChange={(next) => {
            if (!next && !deleting) setDeletingSong(null);
          }}
        >
          <DialogContent className="w-[calc(100%-2rem)] rounded-lg" aria-describedby={undefined}>
            <DialogHeader>
              <DialogTitle>Delete this song?</DialogTitle>
            </DialogHeader>
            <p className="text-sm leading-relaxed text-muted-foreground">
              “{deletingSong?.title}” will be removed from Music and its file deleted. This can't be
              undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeletingSong(null)} disabled={deleting}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => void confirmDelete()}
                disabled={deleting}
              >
                {deleting ? <Loader2 className="animate-spin" /> : <Trash2 />} Delete
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {addingYouTube && (
        <AddYouTubeSongDialog
          open={addingYouTube}
          onClose={() => setAddingYouTube(false)}
          onAdded={(song) => {
            setYoutubeSongs((prev) => [song, ...prev.filter((s) => s.id !== song.id)]);
            setAll((prev) => prev.filter((s) => s.id !== song.id));
            toast.success("YouTube song added to Music.");
          }}
        />
      )}
    </div>
  );
}

/**
 * The "Downloaded" tab — everything here lives in IndexedDB, so it renders and
 * plays with 0 signal. Mirrors the Offline Videos tab: a storage summary up top
 * ("App stays small"), an optional 30-day cleanup prompt, then the songs.
 */
function DownloadedTab({
  songs,
  bytes,
  stale,
  playingId,
  isPlaying,
  onOpen,
  onChanged,
}: {
  songs: SavedSong[];
  bytes: number;
  stale: SavedSong[];
  playingId: string;
  isPlaying: boolean;
  onOpen: (sound: Sound) => void;
  onChanged: () => void;
}) {
  const [cleaning, setCleaning] = useState(false);
  /** "Keep" hides the 30-day prompt until the next visit. */
  const [kept, setKept] = useState(false);

  const cleanUp = async () => {
    if (cleaning) return;
    setCleaning(true);
    try {
      const removed = await removeStaleSongs();
      toast.success(`Deleted ${removed} ${removed === 1 ? "song" : "songs"} to save space.`);
      onChanged();
    } finally {
      setCleaning(false);
    }
  };

  return (
    <section>
      {/* Storage summary — the "app stays small" promise. */}
      <div className="mb-4 rounded-xl border border-emerald-500/25 bg-emerald-500/10 p-3">
        <div className="flex items-center gap-2">
          <HardDriveDownload className="h-4 w-4 shrink-0 text-emerald-400" />
          <p className="text-sm font-bold text-emerald-300">
            Downloaded: {songs.length} {songs.length === 1 ? "song" : "songs"} •{" "}
            {formatStorage(bytes)}
          </p>
        </div>
        <p className="mt-1 pl-6 text-[11px] leading-relaxed text-emerald-200/70">
          App stays small — songs live in your phone's cache, not the app. They play with 0 signal.
        </p>
      </div>

      {/* 30-day cleanup prompt. */}
      {stale.length > 0 && !kept && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <Trash2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-amber-200">
              {stale.length} {stale.length === 1 ? "song hasn't" : "songs haven't"} been played in{" "}
              {STALE_DAYS} days.
            </p>
            <p className="mt-0.5 text-[11px] text-amber-200/70">Delete to save space?</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => void cleanUp()}
                disabled={cleaning}
                className="rounded-full bg-amber-500 px-3 py-1 text-[11px] font-bold text-black disabled:opacity-60"
              >
                {cleaning ? "Deleting…" : "Delete to save space"}
              </button>
              <button
                type="button"
                onClick={() => setKept(true)}
                className="rounded-full border border-amber-500/40 px-3 py-1 text-[11px] font-semibold text-amber-200"
              >
                Keep
              </button>
            </div>
          </div>
        </div>
      )}

      {songs.length ? (
        <div className="space-y-0.5">
          {songs.map((saved, i) => (
            <div
              key={saved.id}
              className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-white/5"
            >
              <span className="w-4 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => onOpen(saved.sound)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                aria-label={`Play ${saved.sound.title}`}
              >
                <div className="relative shrink-0">
                  <SoundCover sound={saved.sound} className="h-12 w-12" rounded="rounded-lg" />
                  <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition hover:opacity-100">
                    {playingId === saved.id && isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4 fill-current" />
                    )}
                  </span>
                </div>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{saved.sound.title}</span>
                    <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-400">
                      <Download className="h-2.5 w-2.5" /> Offline
                    </span>
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {saved.sound.creator_username} · {formatStorage(saved.size)}
                    {saved.file_name ? ` · ${saved.file_name}` : ""}
                  </span>
                </span>
              </button>
              {isYouTubeSound(saved.sound) && (
                <ReplaceAudioButton sound={saved.sound} onReplaced={onChanged} />
              )}
              <RemoveDownloadButton sound={saved.sound} onRemoved={onChanged} />
            </div>
          ))}
        </div>
      ) : (
        <div className="py-10 text-center">
          <WifiOff className="mx-auto h-8 w-8 text-muted-foreground/50" />
          <p className="mt-3 text-sm font-semibold">No downloads yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-muted-foreground">
            Tap ⬇ Download on any song to keep it on your phone. Downloaded songs play the full song
            with 0 signal.
          </p>
        </div>
      )}

      <div className="mt-4 flex gap-2 rounded-xl border border-white/10 bg-white/5 p-3">
        <ShieldAlert className="h-4 w-4 shrink-0 text-muted-foreground" />
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          Coolerup sounds download directly. YouTube songs can't be fetched, so tap Download on one
          and add an audio file you already have — it's stored here, labelled with the file name,
          and plays offline. Picked the wrong song? Tap <span className="font-semibold">Swap</span>.
        </p>
      </div>
    </section>
  );
}

/**
 * "Paste a YouTube link" popup — the Music tab's twin of the Videos tab's
 * Add YouTube dialog. The server reads the title, channel and thumbnail from
 * YouTube and stores them on a `sounds` row with `source = 'youtube'`.
 */
function AddYouTubeSongDialog({
  open,
  onClose,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  onAdded: (song: Sound) => void;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const add = useServerFn(addYouTubeSong);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) onClose();
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] rounded-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Paste YouTube link</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy) return;
            if (!url.trim()) {
              setError("Paste a YouTube link first.");
              return;
            }
            setBusy(true);
            setError("");
            try {
              const song = await add({ data: { url } });
              onAdded(song);
              setUrl("");
              onClose();
            } catch (err) {
              setError(err instanceof Error ? err.message : "Could not add this song.");
            } finally {
              setBusy(false);
            }
          }}
        >
          <Input
            aria-label="YouTube link"
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={(event) => {
              setUrl(event.target.value);
              setError("");
            }}
            disabled={busy}
            autoFocus
          />
          <p className="text-xs text-muted-foreground">
            The title, channel and thumbnail are saved automatically. The song plays from YouTube —
            nothing is downloaded.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy || !url.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <Plus />} {busy ? "Adding…" : "Add"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Upload a song" popup.
 *
 * Picks an audio file from the phone/computer (or drag-and-drop on desktop),
 * lets the user name it and optionally add cover art, then stores it in the
 * `sounds` bucket and creates a `sounds` row. The result plays in the Music tab
 * like any other song and can be downloaded for offline listening.
 */
function UploadSongDialog({
  open,
  onClose,
  onUploaded,
}: {
  open: boolean;
  onClose: () => void;
  onUploaded: (song: Sound) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [cover, setCover] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const coverRef = useRef<HTMLInputElement | null>(null);

  const reset = () => {
    setFile(null);
    setCover(null);
    setTitle("");
    setError("");
    setDragOver(false);
  };

  // Preview the chosen file and release the blob URL when it changes/unmounts.
  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const chooseFile = (next: File | undefined) => {
    if (!next) return;
    const invalid = validateSongFile(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    setFile(next);
    setTitle((prev) => prev.trim() || songTitleFromFileName(next.name));
  };

  const chooseCover = (next: File | undefined) => {
    if (!next) return;
    const invalid = validateCoverFile(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    setCover(next);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!file) {
      setError("Choose an audio file first.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const song = await uploadSong({ file, title, cover });
      onUploaded(song);
      reset();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't upload that song.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !busy) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="w-[calc(100%-2rem)] rounded-lg" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Upload a song</DialogTitle>
        </DialogHeader>
        <form className="space-y-3" onSubmit={submit}>
          <input
            ref={fileRef}
            type="file"
            accept={AUDIO_ACCEPT}
            className="hidden"
            aria-label="Choose an audio file"
            onChange={(e) => {
              const next = e.target.files?.[0];
              e.target.value = "";
              chooseFile(next);
            }}
          />
          <input
            ref={coverRef}
            type="file"
            accept={COVER_ACCEPT}
            className="hidden"
            aria-label="Choose cover art"
            onChange={(e) => {
              const next = e.target.files?.[0];
              e.target.value = "";
              chooseCover(next);
            }}
          />

          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              chooseFile(e.dataTransfer.files?.[0]);
            }}
            className={`flex w-full flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
              dragOver ? "border-primary bg-primary/10" : "border-white/15 hover:border-white/30"
            }`}
          >
            <FileAudio className="h-6 w-6 text-primary" />
            <span className="text-sm font-semibold">
              {file ? "Choose a different file" : "Choose an audio file"}
            </span>
            <span className="text-[11px] text-muted-foreground">
              MP3, M4A, WAV, OGG, OPUS or FLAC · up to {MAX_SONG_UPLOAD_MB} MB
            </span>
          </button>

          {file && (
            <div className="rounded-xl border border-white/10 bg-white/5 p-2.5">
              <div className="flex items-center gap-2">
                <FileAudio className="h-4 w-4 shrink-0 text-emerald-400" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold">{file.name}</p>
                  <p className="text-[11px] text-muted-foreground">{formatFileSize(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setFile(null)}
                  aria-label="Remove chosen file"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-white/10 hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {previewUrl && (
                <audio src={previewUrl} controls preload="metadata" className="mt-2 h-8 w-full" />
              )}
            </div>
          )}

          <div>
            <label
              htmlFor="song-title"
              className="mb-1 block text-xs font-semibold text-muted-foreground"
            >
              Song title
            </label>
            <Input
              id="song-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="My song"
              maxLength={140}
              disabled={busy}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => coverRef.current?.click()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-full border border-white/15 px-3 py-1.5 text-[11px] font-semibold text-muted-foreground hover:text-foreground disabled:opacity-60"
            >
              <ImagePlus className="h-3.5 w-3.5" />{" "}
              {cover ? "Change cover" : "Add cover art (optional)"}
            </button>
            {cover && (
              <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                <span className="max-w-[9rem] truncate">{cover.name}</span>
                <button
                  type="button"
                  onClick={() => setCover(null)}
                  aria-label="Remove cover art"
                  className="text-muted-foreground hover:text-red-400"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )}
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Only upload music you own or have the rights to share. Copyrighted songs can get the
            account banned.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                if (busy) return;
                reset();
                onClose();
              }}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !file}>
              {busy ? <Loader2 className="animate-spin" /> : <Upload />}{" "}
              {busy ? "Uploading…" : "Upload"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
