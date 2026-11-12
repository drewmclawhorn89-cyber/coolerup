import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Heart,
  Loader2,
  Music,
  Pause,
  Play,
  Repeat,
  Search,
  Share2,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import {
  getAllSounds,
  getSavedSoundIds,
  saveSound,
  soundAudioUrl,
  unsaveSound,
} from "@/lib/sounds";
import { songPlayer, useSongPlayer, type PlayerTrack } from "@/lib/songPlayer";

const API = "https://api.audius.co/v1";
const APP = "coolerup";

export type Track = {
  id: string;
  title: string;
  artist: string;
  art?: string | undefined;
  url: string;
};

export const MGK_VIDEOS = [
  { id: "J_n01uvyhI8", title: "my ex's best friend (feat. blackbear)" },
  { id: "0tn6nWYNK3Q", title: "forget me too (feat. Halsey)" },
  { id: "yh_ydvIJAxg", title: "emo girl (feat. WILLOW)" },
  { id: "wSdT-SArM2Q", title: "Bloody Valentine" },
  { id: "vHiFxhPs2TQ", title: "Bloody Valentine (Acoustic)" },
];

type AudiusTrack = {
  id: string | number;
  title: string;
  is_streamable?: boolean;
  user?: { name?: string };
  artwork?: Record<string, string | undefined>;
};

export async function fetchTracks(query: string): Promise<Track[]> {
  const path = query.trim()
    ? `/tracks/search?query=${encodeURIComponent(query.trim())}&`
    : "/tracks/trending?";
  const res = await fetch(`${API}${path}limit=20&app_name=${APP}`);
  if (!res.ok) throw new Error("Music service unavailable");
  const json = (await res.json()) as { data?: AudiusTrack[] };
  return (json.data ?? [])
    .filter((t) => t.is_streamable !== false)
    .map((t) => ({
      id: String(t.id),
      title: t.title,
      artist: t.user?.name ?? "Unknown",
      art: t.artwork?.["150x150"],
      url: `${API}/tracks/${t.id}/stream?app_name=${APP}`,
    }));
}

/** Every original sound uploaded to Coolerup, as playable tracks. */
export async function fetchSoundTracks(query = ""): Promise<Track[]> {
  const sounds = await getAllSounds(150);
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sounds.filter(
        (s) => s.title.toLowerCase().includes(q) || s.creator_username.toLowerCase().includes(q),
      )
    : sounds;

  // Resolve signed URLs in small batches - 150 at once trips storage rate limits.
  const tracks: Track[] = [];
  const BATCH = 12;
  for (let i = 0; i < filtered.length; i += BATCH) {
    const resolved = await Promise.all(
      filtered.slice(i, i + BATCH).map(async (s): Promise<Track | null> => {
        const url = await soundAudioUrl(s);
        if (!url) return null;
        return { id: `sound:${s.id}`, title: s.title, artist: `@${s.creator_username}`, url };
      }),
    );
    for (const t of resolved) if (t) tracks.push(t);
  }
  return tracks;
}

export function useMusicPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const list = useRef<Track[]>([]);
  const indexRef = useRef(0);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mode, setMode] = useState<"songs" | "sounds">("songs");
  const started = useRef(false);

  const play = (i: number) => {
    const el = audio.current;
    const t = list.current[i];
    if (!el || !t) return;
    indexRef.current = i;
    setIndex(i);
    el.src = t.url;
    void el.play().catch(() => setPlaying(false));
  };

  useEffect(() => {
    const el = new Audio();
    audio.current = el;
    el.addEventListener("timeupdate", () => setTime(el.currentTime));
    el.addEventListener("loadedmetadata", () => setDuration(el.duration || 0));
    el.addEventListener("play", () => setPlaying(true));
    el.addEventListener("pause", () => setPlaying(false));
    el.addEventListener("ended", () => {
      if (list.current.length) play((indexRef.current + 1) % list.current.length);
    });
    el.addEventListener("error", () => {
      if (el.src) setError("Couldn't play that song. Try another.");
    });
    return () => {
      el.pause();
      el.removeAttribute("src");
    };
  }, []);

  const search = async (query: string) => {
    setLoading(true);
    setError("");
    setMode("songs");
    try {
      const next = await fetchTracks(query);
      list.current = next;
      setTracks(next);
      if (!next.length) setError("No songs found.");
    } catch {
      setError("Couldn't load songs. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  /** Load every original sound in the app into the same player queue. */
  const loadSounds = async (query = "") => {
    setLoading(true);
    setError("");
    setMode("sounds");
    try {
      const next = await fetchSoundTracks(query);
      list.current = next;
      setTracks(next);
      if (!next.length) setError("No sounds yet. Upload a video to create one.");
    } catch {
      setError("Couldn't load sounds. Check your connection.");
    } finally {
      setLoading(false);
    }
  };

  const n = () => list.current.length;
  return {
    tracks,
    index,
    playing,
    time,
    duration,
    loading,
    error,
    mode,
    search,
    play,
    loadSounds,
    ensureLoaded() {
      if (!started.current) {
        started.current = true;
        void search("");
      }
    },
    toggle() {
      const el = audio.current;
      if (!el || !n()) return;
      if (!el.src) play(indexRef.current);
      else if (el.paused) void el.play();
      else el.pause();
    },
    next: () => n() && play((indexRef.current + 1) % n()),
    prev: () => n() && play((indexRef.current - 1 + n()) % n()),
    seek(v: number) {
      if (audio.current) audio.current.currentTime = v;
    },
  };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function MusicPlayer({
  player,
  open,
}: {
  player: ReturnType<typeof useMusicPlayer>;
  open: boolean;
}) {
  const [q, setQ] = useState("");
  const [showYt, setShowYt] = useState(false);
  const [yt, setYt] = useState(MGK_VIDEOS[0]!);
  const { ensureLoaded } = player;
  useEffect(() => {
    if (open) ensureLoaded();
  }, [open]);
  const current = player.tracks[player.index];
  const started = player.playing || player.time > 0;
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
        <Music className="h-3.5 w-3.5" /> Music
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void (player.mode === "sounds" ? player.loadSounds(q) : player.search(q));
        }}
        className="mb-3 flex items-center gap-2 rounded-full bg-white/5 px-3"
      >
        <Search className="h-4 w-4 text-zinc-500" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={
            player.mode === "sounds" ? "Search sounds or creators" : "Search songs or artists"
          }
          className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-zinc-500"
        />
      </form>
      <div className="mb-3 flex flex-wrap gap-2">
        {(
          [
            ["MGK", "mgk machine gun kelly"],
            ["Trending", ""],
          ] as [string, string][]
        ).map(([label, query]) => (
          <button
            key={label}
            type="button"
            onClick={() => {
              setQ(query);
              setShowYt(false);
              void player.search(query);
            }}
            className="rounded-full bg-white/5 px-3 py-1 text-xs font-semibold hover:bg-white/10"
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setQ("");
            setShowYt(false);
            void player.loadSounds("");
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${player.mode === "sounds" ? "bg-primary" : "bg-white/5 hover:bg-white/10"}`}
        >
          Sounds
        </button>
        <button
          type="button"
          onClick={() => {
            if (!showYt && player.playing) player.toggle();
            setShowYt(!showYt);
          }}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${showYt ? "bg-primary" : "bg-white/5 hover:bg-white/10"}`}
        >
          MGK on YouTube
        </button>
      </div>
      {showYt && (
        <div className="mb-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              key={yt.id}
              src={`https://www.youtube-nocookie.com/embed/${yt.id}?autoplay=1&playsinline=1`}
              title={yt.title}
              allow="autoplay; encrypted-media; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
          <div className="mt-2 max-h-32 space-y-1 overflow-y-auto">
            {MGK_VIDEOS.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setYt(v)}
                className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${v.id === yt.id ? "bg-white/10 font-semibold" : "hover:bg-white/5"}`}
              >
                {v.title}
              </button>
            ))}
          </div>
        </div>
      )}
      {started && current && (
        <div className="mb-3">
          <p className="truncate text-sm font-semibold">
            {current.title} <span className="font-normal text-zinc-400">· {current.artist}</span>
          </p>
          <input
            type="range"
            min={0}
            max={player.duration || 0}
            step={0.1}
            value={Math.min(player.time, player.duration || 0)}
            onChange={(e) => player.seek(Number(e.target.value))}
            aria-label="Seek"
            className="mt-2 w-full accent-primary"
          />
          <div className="flex justify-between text-xs text-zinc-500">
            <span>{fmt(player.time)}</span>
            <span>{fmt(player.duration)}</span>
          </div>
          <div className="mt-1 flex items-center justify-center gap-5">
            <button onClick={player.prev} aria-label="Previous">
              <SkipBack className="h-5 w-5" />
            </button>
            <button
              onClick={player.toggle}
              aria-label={player.playing ? "Pause" : "Play"}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-primary"
            >
              {player.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button onClick={player.next} aria-label="Next">
              <SkipForward className="h-5 w-5" />
            </button>
          </div>
        </div>
      )}
      {player.loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-zinc-400" />
        </div>
      ) : player.error ? (
        <p className="py-2 text-sm text-zinc-500">{player.error}</p>
      ) : (
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {player.tracks.map((t, i) => (
            <button
              key={t.id}
              onClick={() => player.play(i)}
              className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${started && i === player.index ? "bg-white/10" : "hover:bg-white/5"}`}
            >
              {t.art ? (
                <img src={t.art} alt="" className="h-10 w-10 rounded-lg object-cover" />
              ) : (
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10">
                  <Music className="h-4 w-4" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{t.title}</span>
                <span className="block truncate text-xs text-zinc-400">{t.artist}</span>
              </span>
              {started && i === player.index && player.playing && (
                <Play className="h-3.5 w-3.5 fill-current text-primary" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ===========================================================================
 * Music tab — full song player
 *
 * A dock pinned to the bottom of the app. It is mounted once in the root
 * layout, so switching top tabs (For You -> Music -> Videos) never stops the
 * song: the audio element lives in `@/lib/songPlayer`, not in a route.
 * =========================================================================== */

export const USE_SOUND_EVENT = "coolerup:use-sound";

/** Ask the app to open the camera with this song attached ("Use this sound"). */
export function requestUseSound(track: PlayerTrack) {
  window.dispatchEvent(new CustomEvent<PlayerTrack>(USE_SOUND_EVENT, { detail: track }));
}

export function SongPlayerBar() {
  const player = useSongPlayer();
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingBusy, setSavingBusy] = useState(false);

  const track = player.queue[player.index];
  const soundId = track?.soundId ?? "";

  // Reflect the heart state for whichever song is loaded.
  useEffect(() => {
    let alive = true;
    setSaved(false);
    if (!soundId) return;
    void getSavedSoundIds()
      .then((ids) => {
        if (alive) setSaved(ids.has(soundId));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [soundId]);

  if (!player.active || !track) return null;

  const toggleSave = async () => {
    if (savingBusy) return;
    setSavingBusy(true);
    const next = !saved;
    setSaved(next); // optimistic
    const ok = next ? await saveSound(soundId) : await unsaveSound(soundId);
    if (!ok) setSaved(!next);
    setSavingBusy(false);
  };

  const share = async () => {
    const url = `${window.location.origin}/sound/${soundId}`;
    const data = { title: track.title, text: `${track.title} — ${track.artist} on Coolerup`, url };
    try {
      if (navigator.share) await navigator.share(data);
      else await navigator.clipboard.writeText(url);
    } catch {
      /* user cancelled the share sheet */
    }
  };

  const pct = player.duration > 0 ? (player.time / player.duration) * 100 : 0;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/10 bg-zinc-900/95 shadow-2xl backdrop-blur-xl">
        {/* Thin seek bar doubles as the progress indicator in the compact view. */}
        <input
          type="range"
          min={0}
          max={player.duration || 0}
          step={0.1}
          value={Math.min(player.time, player.duration || 0)}
          onChange={(e) => songPlayer.seek(Number(e.target.value))}
          aria-label="Seek"
          className="block h-1 w-full cursor-pointer appearance-none bg-white/15 accent-primary [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
          style={{
            background: `linear-gradient(to right, var(--primary, #f97316) ${pct}%, rgba(255,255,255,0.15) ${pct}%)`,
          }}
        />

        {expanded && (
          <div className="px-4 pt-3">
            <div className="flex items-center gap-4">
              <div
                className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl text-3xl font-black text-white/90"
                style={{ background: track.cover }}
                aria-hidden="true"
              >
                {(track.title || "?").charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-bold">{track.title}</p>
                <p className="truncate text-sm text-zinc-400">{track.artist}</p>
                <div className="mt-1 flex justify-between text-[11px] tabular-nums text-zinc-500">
                  <span>{fmt(player.time)}</span>
                  <span>{fmt(player.duration)}</span>
                </div>
              </div>
            </div>

            <div className="mt-3 flex items-center justify-center gap-6">
              <button
                type="button"
                onClick={() => songPlayer.toggleLoop()}
                aria-label={player.loop ? "Turn loop off" : "Loop this song"}
                aria-pressed={player.loop}
                className={`rounded-full p-1.5 ${player.loop ? "text-primary" : "text-zinc-400"}`}
              >
                <Repeat className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => songPlayer.prev()} aria-label="Previous">
                <SkipBack className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => songPlayer.toggle()}
                aria-label={player.playing ? "Pause" : "Play"}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground"
              >
                {player.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
              </button>
              <button type="button" onClick={() => songPlayer.next()} aria-label="Next">
                <SkipForward className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => songPlayer.toggleMute()}
                aria-label={player.muted ? "Unmute" : "Mute"}
                className="rounded-full p-1.5 text-zinc-400"
              >
                {player.muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>

            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={player.muted ? 0 : player.volume}
              onChange={(e) => songPlayer.setVolume(Number(e.target.value))}
              aria-label="Volume"
              className="mt-2 w-full accent-primary"
            />

            <div className="mt-3 flex items-center gap-2 pb-3">
              <button
                type="button"
                onClick={() => requestUseSound(track)}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-full bg-primary py-2 text-xs font-bold text-primary-foreground"
              >
                <Clapperboard className="h-3.5 w-3.5" /> Use this sound
              </button>
              <button
                type="button"
                onClick={() => void toggleSave()}
                aria-pressed={saved}
                className="flex items-center justify-center gap-1.5 rounded-full border border-white/15 px-3 py-2 text-xs font-semibold"
              >
                <Heart className={`h-3.5 w-3.5 ${saved ? "fill-red-500 text-red-500" : ""}`} />
                {saved ? "Saved" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void share()}
                aria-label="Share this sound"
                className="flex items-center justify-center rounded-full border border-white/15 px-3 py-2"
              >
                <Share2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse player" : "Expand player"}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-base font-black text-white/90"
              style={{ background: track.cover }}
              aria-hidden="true"
            >
              {(track.title || "?").charAt(0).toUpperCase()}
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{track.title}</span>
              <span className="block truncate text-xs text-zinc-400">{track.artist}</span>
            </span>
          </button>
          <button
            type="button"
            onClick={() => songPlayer.toggle()}
            aria-label={player.playing ? "Pause" : "Play"}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-black"
          >
            {player.loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : player.playing ? (
              <Pause className="h-4 w-4" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? "Collapse" : "Expand"}
            className="shrink-0 text-zinc-400"
          >
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => songPlayer.stop()}
            aria-label="Close player"
            className="shrink-0 text-zinc-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
