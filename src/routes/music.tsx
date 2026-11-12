import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Flame,
  Heart,
  Loader2,
  Music2,
  Search,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { SongCard, SongRow } from "@/components/SongCard";
import { songPlayer, useSongPlayer, type PlayerTrack } from "@/lib/songPlayer";
import {
  FULL_SONG_SECONDS,
  getAllSounds,
  getKnownDuration,
  getSavedSounds,
  getTopSounds,
  getTrendingSoundsThisWeek,
  isFullSong,
  probeSoundDurations,
  saveSound,
  soundAudioUrl,
  soundCoverGradient,
  unsaveSound,
  type Sound,
} from "@/lib/sounds";

export const Route = createFileRoute("/music")({
  component: MusicPage,
});

type MusicTab = "top" | "trending" | "mine" | "full";

const TABS: { id: MusicTab; label: string }[] = [
  { id: "top", label: "Top Songs" },
  { id: "trending", label: "Trending" },
  { id: "mine", label: "Your Sounds" },
  { id: "full", label: "Full Songs" },
];

function toTrack(sound: Sound, url: string): PlayerTrack {
  return {
    soundId: sound.id,
    title: sound.title,
    artist: `@${sound.creator_username}`,
    url,
    cover: soundCoverGradient(sound.id),
  };
}

function MusicPage() {
  const navigate = useNavigate();
  const auth = useAuth();
  const player = useSongPlayer();

  const [tab, setTab] = useState<MusicTab>("top");
  const [query, setQuery] = useState("");
  const [all, setAll] = useState<Sound[]>([]);
  const [top, setTop] = useState<Sound[]>([]);
  const [trending, setTrending] = useState<Sound[]>([]);
  const [saved, setSaved] = useState<Sound[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [probing, setProbing] = useState(false);
  const [durationVersion, setDurationVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [allSounds, topSounds, trendingSounds] = await Promise.all([
        getAllSounds(200),
        getTopSounds(10),
        getTrendingSoundsThisWeek(20),
      ]);
      setAll(allSounds);
      setTop(topSounds);
      setTrending(trendingSounds);

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
    return all.filter(
      (s) => s.title.toLowerCase().includes(q) || s.creator_username.toLowerCase().includes(q),
    );
  }, [all, query]);

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
  const openSong = useCallback(async (sound: Sound, list: Sound[]) => {
    try {
      const url = await soundAudioUrl(sound);
      if (!url) {
        toast.error("That sound isn't playable right now.");
        return;
      }
      const track = toTrack(sound, url);
      songPlayer.playQueue([track], 0);

      // Fill the queue in the background so Next/Prev work.
      const rest = list.filter((s) => s.id !== sound.id).slice(0, 24);
      const resolved: PlayerTrack[] = [];
      for (let i = 0; i < rest.length; i += 6) {
        const batch = await Promise.all(
          rest.slice(i, i + 6).map(async (s) => {
            const u = await soundAudioUrl(s);
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
  }, []);

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
            <section className="mb-6">
              <div className="mb-2 flex items-center gap-1.5 px-1">
                <Music2 className="h-4 w-4 text-sky-400" />
                <h2 className="text-sm font-bold">Full Songs</h2>
              </div>
              {renderList(fullSongs.slice(0, 10), "No full-length songs yet.")}
            </section>
          </>
        ) : tab === "trending" ? (
          <section>{renderList(trending, "Nothing trending this week.")}</section>
        ) : tab === "mine" ? (
          <section>
            {renderList(
              saved,
              auth.user
                ? "No saved sounds yet. Tap the heart on any song."
                : "Sign in to save sounds to Your Sounds.",
            )}
          </section>
        ) : (
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
        )}
      </div>
    </div>
  );
}
