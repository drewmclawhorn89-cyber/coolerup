import { useEffect, useState } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronUp,
  Clapperboard,
  Heart,
  Loader2,
  Lock,
  Music,
  Pause,
  Play,
  Repeat,
  Share2,
  SkipBack,
  SkipForward,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";

import { DownloadButton } from "@/components/DownloadButton";
import {
  attachBackgroundPlay,
  canBackgroundPlay,
  isBackgroundPlayEnabled,
  setBackgroundPlayEntitled,
  YOUTUBE_BACKGROUND_SHORT,
  YOUTUBE_BACKGROUND_WARNING,
} from "@/lib/backgroundPlay";
import { useAuth } from "@/hooks/useAuth";
import { hasBackgroundPlayAccess, SUBSCRIPTION_EVENT } from "@/lib/subscriptions";
import { LIFETIME_EVENT } from "@/lib/subscription";
import { getSavedSoundIds, saveSound, unsaveSound } from "@/lib/sounds";
import { requestUseSound, songPlayer, trackToSound, useSongPlayer } from "@/lib/songPlayer";

/**
 * MiniPlayer
 * ----------
 * The always-visible bar at the bottom of the app: cover, song name, play /
 * pause, next, and X to stop — like TikTok's music bar or Spotify's mini player.
 *
 * It is mounted once in the root layout, and the audio element itself lives in
 * `@/lib/songPlayer`, so switching tabs (For You -> Videos -> Shop -> LIVE)
 * never interrupts the song. Tapping the bar opens the full player in the Music
 * tab; the chevron expands the in-place panel instead.
 *
 * This component is also where background play is switched on: it attaches the
 * Media Session handlers that give you lock-screen controls.
 */

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

export function MiniPlayer() {
  const auth = useAuth();
  const player = useSongPlayer();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [expanded, setExpanded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savingBusy, setSavingBusy] = useState(false);

  const track = player.queue[player.index];
  const soundId = track?.soundId ?? "";

  // Lock-screen controls + "pause when hidden unless background play is on".
  useEffect(() => attachBackgroundPlay(), []);

  // Background play is a VIP perk. Re-derive the entitlement whenever the plan
  // changes, the app regains focus, or a lifetime grant is revoked, so a
  // downgrade stops background audio immediately instead of at the next song.
  useEffect(() => {
    const sync = () => setBackgroundPlayEntitled(hasBackgroundPlayAccess(auth.handle));
    sync();
    window.addEventListener(SUBSCRIPTION_EVENT, sync);
    window.addEventListener(LIFETIME_EVENT, sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(SUBSCRIPTION_EVENT, sync);
      window.removeEventListener(LIFETIME_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [auth.handle]);

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

  const isYouTube = !canBackgroundPlay(track);
  const backgroundOn = isBackgroundPlayEnabled();
  const backgroundEntitled = hasBackgroundPlayAccess(auth.handle);
  const onMusicTab = pathname === "/music";

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

  /** Tapping the bar opens the full player in the Music tab. */
  const openFullPlayer = () => {
    if (onMusicTab) setExpanded((v) => !v);
    else void navigate({ to: "/music" });
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

        {/* YouTube songs can't survive the app going to the background. Say so
            instead of letting the song silently stop. */}
        {isYouTube && (
          <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/10 px-3 py-1.5">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
            <p
              className="text-[11px] leading-tight text-amber-200"
              title={YOUTUBE_BACKGROUND_WARNING}
            >
              {YOUTUBE_BACKGROUND_SHORT} — use your own MP3 or a royalty-free song.
            </p>
          </div>
        )}

        {/* Background play is a VIP perk. Tell non-VIP listeners why the song
            stops when they leave the app, and give them a way to unlock it. */}
        {!backgroundEntitled && !isYouTube && (
          <button
            type="button"
            onClick={() => void navigate({ to: "/settings", search: { subscriptions: true } })}
            className="flex w-full items-start gap-2 border-b border-primary/20 bg-primary/10 px-3 py-1.5 text-left"
          >
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="text-[11px] leading-tight text-primary">
              Background play is a VIP perk — upgrade to keep music playing when you leave the
              app.
            </span>
          </button>
        )}

        {expanded && (
          <div className="px-4 pt-3">
            <div className="flex items-center gap-4">
              <div
                className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-2xl text-3xl font-black text-white/90"
                style={{ background: track.cover }}
                aria-hidden="true"
              >
                {track.coverUrl ? (
                  <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  (track.title || "?").charAt(0).toUpperCase()
                )}
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

            <div className="mt-3 flex items-center gap-2">
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

            {/* Download for Offline — stores the audio file in IndexedDB so the
                full song plays with 0 signal, in the background too. */}
            <div className="mt-2 flex items-center gap-2 pb-3">
              <DownloadButton sound={trackToSound(track)} variant="wide" />
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 px-3 py-2">
          <button
            type="button"
            onClick={openFullPlayer}
            className="flex min-w-0 flex-1 items-center gap-3 text-left"
            aria-expanded={expanded}
            aria-label={onMusicTab ? "Expand player" : "Open the Music tab"}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg text-base font-black text-white/90"
              style={{ background: track.cover }}
              aria-hidden="true"
            >
              {track.coverUrl ? (
                <img src={track.coverUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                (track.title || "?").charAt(0).toUpperCase()
              )}
            </div>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{track.title}</span>
              <span className="block truncate text-xs text-zinc-400">
                {track.artist}
                {backgroundOn && !isYouTube && (
                  <span className="ml-1.5 inline-flex items-center gap-1 text-[10px] text-emerald-400">
                    <Music className="h-2.5 w-2.5" /> background
                  </span>
                )}
              </span>
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
            onClick={() => songPlayer.next()}
            aria-label="Next song"
            className="flex h-9 w-9 shrink-0 items-center justify-center text-zinc-300"
          >
            <SkipForward className="h-4 w-4" />
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
