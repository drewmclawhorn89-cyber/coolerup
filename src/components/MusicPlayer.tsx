import { useEffect, useRef, useState } from "react";
import { Loader2, Music, Pause, Play, Search, SkipBack, SkipForward } from "lucide-react";

const API = "https://api.audius.co/v1";
const APP = "coolerup";

export type Track = { id: string; title: string; artist: string; art?: string; url: string };

async function fetchTracks(query: string): Promise<Track[]> {
  const path = query.trim()
    ? `/tracks/search?query=${encodeURIComponent(query.trim())}&`
    : "/tracks/trending?";
  const res = await fetch(`${API}${path}limit=20&app_name=${APP}`);
  if (!res.ok) throw new Error("Music service unavailable");
  const json = await res.json();
  return (json.data ?? []).filter((t: any) => t.is_streamable !== false).map((t: any) => ({
    id: String(t.id),
    title: t.title,
    artist: t.user?.name ?? "Unknown",
    art: t.artwork?.["150x150"],
    url: `${API}/tracks/${t.id}/stream?app_name=${APP}`,
  }));
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
    el.addEventListener("ended", () => { if (list.current.length) play((indexRef.current + 1) % list.current.length); });
    el.addEventListener("error", () => { if (el.src) setError("Couldn't play that song. Try another."); });
    return () => { el.pause(); el.removeAttribute("src"); };
  }, []);

  const search = async (query: string) => {
    setLoading(true);
    setError("");
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

  const n = () => list.current.length;
  return {
    tracks, index, playing, time, duration, loading, error, search, play,
    ensureLoaded() { if (!started.current) { started.current = true; void search(""); } },
    toggle() {
      const el = audio.current;
      if (!el || !n()) return;
      if (!el.src) play(indexRef.current);
      else if (el.paused) void el.play();
      else el.pause();
    },
    next: () => n() && play((indexRef.current + 1) % n()),
    prev: () => n() && play((indexRef.current - 1 + n()) % n()),
    seek(v: number) { if (audio.current) audio.current.currentTime = v; },
  };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function MusicPlayer({ player, open }: { player: ReturnType<typeof useMusicPlayer>; open: boolean }) {
  const [q, setQ] = useState("");
  const { ensureLoaded } = player;
  useEffect(() => { if (open) ensureLoaded(); }, [open]);
  const current = player.tracks[player.index];
  const started = player.playing || player.time > 0;
  return (
    <div className="min-w-0 rounded-2xl border border-white/10 p-3 sm:p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500"><Music className="h-3.5 w-3.5" /> Music</div>
      <form onSubmit={(e) => { e.preventDefault(); void player.search(q); }} className="mb-3 flex items-center gap-2 rounded-full bg-white/5 px-3">
        <Search className="h-4 w-4 text-zinc-500" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search songs or artists" className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-zinc-500" />
      </form>
      {started && current && (
        <div className="mb-3">
          <p className="truncate text-sm font-semibold">{current.title} <span className="font-normal text-zinc-400">· {current.artist}</span></p>
          <input type="range" min={0} max={player.duration || 0} step={0.1} value={Math.min(player.time, player.duration || 0)} onChange={(e) => player.seek(Number(e.target.value))} aria-label="Seek" className="mt-2 w-full accent-primary" />
          <div className="flex justify-between text-xs text-zinc-500"><span>{fmt(player.time)}</span><span>{fmt(player.duration)}</span></div>
          <div className="mt-1 flex items-center justify-center gap-5">
            <button onClick={player.prev} aria-label="Previous"><SkipBack className="h-5 w-5" /></button>
            <button onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary">{player.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
            <button onClick={player.next} aria-label="Next"><SkipForward className="h-5 w-5" /></button>
          </div>
        </div>
      )}
      {player.loading ? <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-zinc-400" /></div> : player.error ? <p className="py-2 text-sm text-zinc-500">{player.error}</p> : (
        <div className="max-h-48 space-y-1 overflow-y-auto">{player.tracks.map((t, i) => (
          <button key={t.id} onClick={() => player.play(i)} className={`flex w-full items-center gap-3 rounded-xl p-2 text-left ${started && i === player.index ? "bg-white/10" : "hover:bg-white/5"}`}>
            {t.art ? <img src={t.art} alt="" className="h-10 w-10 rounded-lg object-cover" /> : <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/10"><Music className="h-4 w-4" /></span>}
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{t.title}</span><span className="block truncate text-xs text-zinc-400">{t.artist}</span></span>
            {started && i === player.index && player.playing && <Play className="h-3.5 w-3.5 fill-current text-primary" />}
          </button>
        ))}</div>
      )}
    </div>
  );
}
