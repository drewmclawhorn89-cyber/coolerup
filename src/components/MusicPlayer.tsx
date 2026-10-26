import { useEffect, useRef, useState } from "react";
import { Music, Pause, Play, Plus, SkipBack, SkipForward } from "lucide-react";

export type Track = { id: string; name: string; url: string };

export function useMusicPlayer() {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const tracksRef = useRef<Track[]>([]);
  tracksRef.current = tracks;

  useEffect(() => {
    const el = new Audio();
    audio.current = el;
    el.addEventListener("timeupdate", () => setTime(el.currentTime));
    el.addEventListener("loadedmetadata", () => setDuration(el.duration || 0));
    el.addEventListener("play", () => setPlaying(true));
    el.addEventListener("pause", () => setPlaying(false));
    return () => {
      el.pause();
      tracksRef.current.forEach((t) => URL.revokeObjectURL(t.url));
    };
  }, []);

  const load = (i: number, list = tracksRef.current, autoplay = true) => {
    const el = audio.current;
    const t = list[i];
    if (!el || !t) return;
    setIndex(i);
    el.src = t.url;
    if (autoplay) void el.play().catch(() => setPlaying(false));
  };

  useEffect(() => {
    const el = audio.current;
    if (!el) return;
    const onEnd = () => { if (tracksRef.current.length) load((index + 1) % tracksRef.current.length); };
    el.addEventListener("ended", onEnd);
    return () => el.removeEventListener("ended", onEnd);
  }, [index]);

  return {
    tracks, index, playing, time, duration,
    add(files: FileList | null) {
      const added = Array.from(files ?? []).filter((f) => f.type.startsWith("audio/")).map((f) => ({
        id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
        name: f.name.replace(/\.[^.]+$/, ""),
        url: URL.createObjectURL(f),
      }));
      if (!added.length) return;
      const wasEmpty = tracksRef.current.length === 0;
      const next = [...tracksRef.current, ...added];
      setTracks(next);
      if (wasEmpty) load(0, next);
    },
    play: (i: number) => load(i),
    toggle() {
      const el = audio.current;
      if (!el || !tracksRef.current.length) return;
      if (!el.src) load(index);
      else if (el.paused) void el.play();
      else el.pause();
    },
    next: () => tracksRef.current.length && load((index + 1) % tracksRef.current.length),
    prev: () => tracksRef.current.length && load((index - 1 + tracksRef.current.length) % tracksRef.current.length),
    seek(v: number) { if (audio.current) audio.current.currentTime = v; },
  };
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function MusicPlayer({ player }: { player: ReturnType<typeof useMusicPlayer> }) {
  const input = useRef<HTMLInputElement>(null);
  const current = player.tracks[player.index];
  return (
    <div className="rounded-2xl border border-white/10 p-4">
      <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
        <Music className="h-3.5 w-3.5" /> Music
        <button onClick={() => input.current?.click()} aria-label="Add songs" className="ml-auto flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 normal-case tracking-normal text-white hover:bg-white/20"><Plus className="h-3.5 w-3.5" />Add songs</button>
        <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => { player.add(e.target.files); e.target.value = ""; }} />
      </div>
      {!current ? <p className="py-2 text-sm text-zinc-500">Add songs from your device to play them here.</p> : (
        <>
          <p className="truncate text-sm font-semibold">{current.name}</p>
          <input type="range" min={0} max={player.duration || 0} step={0.1} value={Math.min(player.time, player.duration || 0)} onChange={(e) => player.seek(Number(e.target.value))} aria-label="Seek" className="mt-2 w-full accent-primary" />
          <div className="flex justify-between text-xs text-zinc-500"><span>{fmt(player.time)}</span><span>{fmt(player.duration)}</span></div>
          <div className="mt-1 flex items-center justify-center gap-5">
            <button onClick={player.prev} aria-label="Previous"><SkipBack className="h-5 w-5" /></button>
            <button onClick={player.toggle} aria-label={player.playing ? "Pause" : "Play"} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary">{player.playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}</button>
            <button onClick={player.next} aria-label="Next"><SkipForward className="h-5 w-5" /></button>
          </div>
          {player.tracks.length > 1 && (
            <div className="mt-3 max-h-28 space-y-1 overflow-y-auto">{player.tracks.map((t, i) => (
              <button key={t.id} onClick={() => player.play(i)} className={`block w-full truncate rounded-lg px-2 py-1.5 text-left text-sm ${i === player.index ? "bg-white/10 font-semibold" : "text-zinc-400 hover:bg-white/5"}`}>{t.name}</button>
            ))}</div>
          )}
        </>
      )}
    </div>
  );
}
