import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Download,
  Flame,
  HardDriveDownload,
  Heart,
  Loader2,
  Music2,
  Pause,
  Play,
  Plus,
  Search,
  ShieldAlert,
  Sparkles,
  Trash2,
  WifiOff,
  Youtube,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/useAuth";
import { SongCard, SongRow, SoundCover } from "@/components/SongCard";
import { RemoveDownloadButton } from "@/components/DownloadButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { requestUseSound, YouTubeSongPlayer } from "@/components/MusicPlayer";
import { songPlayer, useSongPlayer, type PlayerTrack } from "@/lib/songPlayer";
import {
  FULL_SONG_SECONDS,
  getAllSounds,
  getKnownDuration,
  getSavedSounds,
  getTopSounds,
  getTrendingSoundsThisWeek,
  isFullSong,
  isYouTubeSound,
  probeSoundDurations,
  saveSound,
  soundAudioUrl,
  soundCoverGradient,
  unsaveSound,
  type Sound,
} from "@/lib/sounds";
import {
  addYouTubeSong,
  getYouTubeSongs,
  incrementSoundPlay,
  youtubeSongId,
} from "@/lib/youtubeSongs";
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
  const [all, setAll] = useState<Sound[]>([]);
  const [youtubeSongs, setYoutubeSongs] = useState<Sound[]>([]);
  const [top, setTop] = useState<Sound[]>([]);
  const [trending, setTrending] = useState<Sound[]>([]);
  const [saved, setSaved] = useState<Sound[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [probing, setProbing] = useState(false);
  const [durationVersion, setDurationVersion] = useState(0);
  /** The YouTube song open in the full-song player, if any. */
  const [activeYouTube, setActiveYouTube] = useState<Sound | null>(null);
  const [addingYouTube, setAddingYouTube] = useState(false);
  /** Songs stored in IndexedDB — these play with no signal at all. */
  const [downloadedSongs, setDownloadedSongs] = useState<SavedSong[]>([]);
  const [downloadBytes, setDownloadBytes] = useState(0);
  /** Downloaded songs untouched for 30 days — offered up for deletion. */
  const [staleSongs, setStaleSongs] = useState<SavedSong[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [allSounds, topSounds, trendingSounds, youTube] = await Promise.all([
        getAllSounds(200),
        getTopSounds(10),
        getTrendingSoundsThisWeek(20),
        getYouTubeSongs(50).catch(() => [] as Sound[]),
      ]);
      setAll(allSounds);
      setTop(topSounds);
      setTrending(trendingSounds);
      setYoutubeSongs(youTube);

      if (auth.user) {
        const mine = await getSavedSounds();
        setSaved(mine);
        setSavedIds(new Set(mine.map((s) => s.id)));
      } else {
        setSaved([]);
        setSavedIds(new Set());
      }
    } catch {
      setError("Couldn't load songs. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Keep the Downloaded tab in sync with IndexedDB. This is read straight from
   * the device, so it works before (and without) any network request.
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
    void refreshDownloads();
    return onOfflineSongsChange(() => void refreshDownloads());
  }, [refreshDownloads]);

  // Measure real song lengths the first time "Full Songs" is opened. Doing it
  // up front would download metadata for every sound on the page.
  const probedRef = useRef(false);
  useEffect(() => {
    if (tab !== "full" || probedRef.current || !all.length) return;
    probedRef.current = true;
    setProbing(true);
    void probeSoundDurations(all, 24)
      .catch(() => undefined)
      .finally(() => {
        setProbing(false);
        setDurationVersion((n) => n + 1);
      });
  }, [tab, all]);

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return [...all, ...youtubeSongs].filter(
      (s) => s.title.toLowerCase().includes(q) || s.creator_username.toLowerCase().includes(q),
    );
  }, [all, youtubeSongs, query]);

  const fullSongs = useMemo(() => {
    // Song lengths live in a module-level cache, not in React state, so
    // `durationVersion` is the reactive signal that probing has finished.
    void durationVersion;
    const measured = all.filter((s) => isFullSong(s.id));
    if (measured.length) return measured;
    // Nothing measured yet (or every file is short) — show the longest known.
    return [...all]
      .filter((s) => {
        const d = getKnownDuration(s.id);
        return typeof d === "number" && d > 0;
      })
      .sort((a, b) => (getKnownDuration(b.id) ?? 0) - (getKnownDuration(a.id) ?? 0));
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
        void load();
      }
    },
    [auth.user, savedIds, load],
  );

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
  const resolvePlayableUrl = useCallback(async (sound: Sound): Promise<string> => {
    const local = await offlineSongUrl(sound.id).catch(() => "");
    if (local) return local;
    return soundAudioUrl(sound);
  }, []);

  const openSong = useCallback(
    async (sound: Sound, list: Sound[]) => {
      // YouTube songs stream from YouTube's embed player — unless the user
      // attached an audio file, in which case the local copy plays offline.
      if (isYouTubeSound(sound)) {
        const local = await offlineSongUrl(sound.id).catch(() => "");
        if (local) {
          const track = { ...toTrack(sound, local), source: "own" as const };
          songPlayer.playQueue([track], 0);
          void markSongPlayed(sound.id);
          return;
        }
        songPlayer.stop();
        setActiveYouTube(sound);
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
    [resolvePlayableUrl, downloadedSongs.length],
  );

  const nowPlayingId = player.queue[player.index]?.soundId ?? "";

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

  const renderRow = (title: string, icon: ReactNode, sounds: Sound[], empty: string) => (
    <section className="mb-6">
      <div className="mb-2 flex items-center gap-1.5 px-1">
        {icon}
        <h2 className="text-sm font-bold">{title}</h2>
        <span className="text-[11px] text-muted-foreground">{sounds.length}</span>
      </div>
      {sounds.length ? (
        <div className="no-scrollbar -mx-4 flex gap-3 overflow-x-auto px-4 pb-1">
          {sounds.map((s) => (
            <SongCard
              key={s.id}
              sound={s}
              playing={nowPlayingId === s.id && player.playing}
              saved={savedIds.has(s.id)}
              onToggleSave={() => void toggleSave(s)}
              onOpen={() => void openSong(s, sounds)}
            />
          ))}
        </div>
      ) : (
        <p className="px-1 py-3 text-sm text-muted-foreground">{empty}</p>
      )}
    </section>
  );

  return (
    <div className="min-h-dvh bg-background pb-32">
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
          <button
            type="button"
            onClick={() => {
              if (!auth.user) {
                void auth.signIn();
                return;
              }
              setAddingYouTube(true);
            }}
            className="ml-auto flex items-center gap-1 rounded-full bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-500"
          >
            <Plus className="h-3.5 w-3.5" /> Add YouTube Song
          </button>
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
              className="h-10 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
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
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-2xl px-4 pt-4">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="py-10 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="mt-3 rounded-full bg-primary px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Try again
            </button>
          </div>
        ) : searchResults ? (
          <section>
            <h2 className="mb-2 px-1 text-sm font-bold">
              Results for “{query}”{" "}
              <span className="text-muted-foreground">{searchResults.length}</span>
            </h2>
            {renderList(searchResults, "No songs match that search.")}
          </section>
        ) : tab === "top" ? (
          <>
            {renderRow(
              "Top Songs",
              <Flame className="h-4 w-4 text-orange-500" />,
              top,
              "No songs yet.",
            )}
            {renderRow(
              "Trending Sounds",
              <Sparkles className="h-4 w-4 text-primary" />,
              trending,
              "Nothing trending this week.",
            )}
            {renderRow(
              "Your Sounds",
              <Heart className="h-4 w-4 text-red-500" />,
              saved,
              auth.user ? "Tap the heart on a song to save it here." : "Sign in to save sounds.",
            )}
            {renderRow(
              "YouTube Songs",
              <Youtube className="h-4 w-4 text-red-600" />,
              youtubeSongs,
              "No YouTube songs yet. Tap + Add YouTube Song to paste a link.",
            )}
            <section className="mb-6">
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <Music2 className="h-4 w-4 text-sky-400" />
                <h2 className="text-sm font-bold">Full Songs</h2>
              </div>
              {renderList(fullSongs.slice(0, 10), "No full-length songs yet.")}
            </section>
          </>
        ) : tab === "trending" ? (
          <section>
            {renderList(trending, "Nothing trending this week.")}
            <div className="mt-6">
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <Youtube className="h-4 w-4 text-red-600" />
                <h2 className="text-sm font-bold">YouTube Songs</h2>
                <span className="text-[11px] text-muted-foreground">{youtubeSongs.length}</span>
              </div>
              {renderList(youtubeSongs, "No YouTube songs yet.")}
            </div>
          </section>
        ) : tab === "mine" ? (
          <section>
            {renderList(
              saved,
              auth.user
                ? "No saved sounds yet. Tap the heart on any song."
                : "Sign in to save sounds to Your Sounds.",
            )}
          </section>
        ) : tab === "full" ? (
          <section>
            {probing && (
              <p className="mb-2 flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Measuring song lengths…
              </p>
            )}
            {probing && !fullSongs.length ? (
              <p className="px-1 py-6 text-sm text-muted-foreground">Measuring song lengths…</p>
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
      </div>

      {/* Full-song YouTube player — streams from YouTube, not a stored file. */}
      {activeYouTube && (
        <div className="fixed inset-x-0 bottom-0 z-[60] flex justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
          <div className="w-full max-w-md">
            <YouTubeSongPlayer
              key={activeYouTube.id}
              sound={activeYouTube}
              videoId={youtubeSongId(activeYouTube) ?? ""}
              saved={savedIds.has(activeYouTube.id)}
              onToggleSave={() => void toggleSave(activeYouTube)}
              onUse={() => {
                requestUseSound(toTrack(activeYouTube, ""));
                setActiveYouTube(null);
              }}
              onPrev={
                youtubeSongs.length > 1
                  ? () => {
                      const i = youtubeSongs.findIndex((s) => s.id === activeYouTube.id);
                      const prev =
                        youtubeSongs[(i - 1 + youtubeSongs.length) % youtubeSongs.length];
                      if (prev) setActiveYouTube(prev);
                    }
                  : undefined
              }
              onNext={
                youtubeSongs.length > 1
                  ? () => {
                      const i = youtubeSongs.findIndex((s) => s.id === activeYouTube.id);
                      const next = youtubeSongs[(i + 1) % youtubeSongs.length];
                      if (next) setActiveYouTube(next);
                    }
                  : undefined
              }
              onClose={() => setActiveYouTube(null)}
            />
          </div>
        </div>
      )}

      <AddYouTubeSongDialog
        open={addingYouTube}
        onClose={() => setAddingYouTube(false)}
        onAdded={(song) => {
          setYoutubeSongs((prev) => [song, ...prev.filter((s) => s.id !== song.id)]);
          setAll((prev) => prev.filter((s) => s.id !== song.id));
          toast.success("YouTube song added to Music.");
        }}
      />
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
                  </span>
                </span>
              </button>
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
          and pick an audio file you already have — it's stored here and plays offline.
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
