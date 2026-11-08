import { useCallback, useEffect, useRef, useState } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatDuration } from "@/lib/fullVideos";

export type Quality = "1080p" | "720p" | "480p" | "auto";

const QUALITIES: Quality[] = ["auto", "1080p", "720p", "480p"];

export type YouTubePlayerProps = {
  /** Resolved (signed) URL for the default rendition. */
  src: string;
  /** Optional per-rendition URLs; a quality is only offered when it exists. */
  sources?: Partial<Record<Exclude<Quality, "auto">, string | null>> | undefined;
  poster?: string | undefined;
  /** Called once, the first time playback actually starts. */
  onFirstPlay?: () => void;
  className?: string;
};

/**
 * Ask the device to stay upright while the player is fullscreen.
 *
 * `screen.orientation.lock` only exists on mobile Chrome/Android; iOS Safari
 * and desktop either reject it or lack it entirely, so every call is guarded
 * and failure is silent — the 9:16 frame in the markup still gives a portrait
 * player on a wide screen.
 */
type LockableOrientation = {
  lock?: (orientation: "portrait" | "portrait-primary") => Promise<void>;
  unlock?: () => void;
};

function orientationApi(): LockableOrientation | null {
  if (typeof screen === "undefined") return null;
  return (screen.orientation as unknown as LockableOrientation | undefined) ?? null;
}

async function lockPortrait(): Promise<void> {
  try {
    await orientationApi()?.lock?.("portrait");
  } catch {
    /* unsupported or blocked — the CSS frame covers it */
  }
}

function unlockOrientation(): void {
  try {
    orientationApi()?.unlock?.();
  } catch {
    /* nothing to release */
  }
}

/**
 * A YouTube-style player: click-to-play, a scrub bar with buffered range, a
 * volume slider, a quality menu and a fullscreen toggle.
 *
 * Deliberately not the TikTok player — no autoplay-on-scroll, no swipe. The
 * controls sit on top of the video and fade out while playing.
 */
export function YouTubePlayer({ src, sources, poster, onFirstPlay, className = "" }: YouTubePlayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [quality, setQuality] = useState<Quality>("auto");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [started, setStarted] = useState(false);

  const hideTimer = useRef<number | null>(null);

  /** Which URL should actually be playing right now. */
  const activeSrc =
    quality !== "auto" && sources?.[quality] ? (sources[quality] as string) : src;

  /* ---------------- playback ---------------- */

  const togglePlay = useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  }, []);

  const seekTo = (seconds: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(seconds, el.duration || 0));
    setCurrent(el.currentTime);
  };

  const toggleMute = () => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = !el.muted;
    setMuted(el.muted);
  };

  const toggleFullscreen = async () => {
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
        // Portrait, like a phone-shaped player. Mobile browsers honour the
        // lock; desktop has no orientation, so the CSS frame does the work.
        await lockPortrait();
      } else {
        await document.exitFullscreen();
        unlockOrientation();
      }
    } catch {
      /* iOS Safari refuses fullscreen on non-video elements; ignore. */
      const video = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
      try {
        video?.webkitEnterFullscreen?.();
      } catch {
        /* nothing else we can do */
      }
    }
  };

  useEffect(() => {
    const onFsChange = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      if (active) void lockPortrait();
      else unlockOrientation();
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  /* ---------------- controls visibility ---------------- */

  const revealControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // Never hide the bar while paused or while the quality menu is open.
      if (videoRef.current && !videoRef.current.paused && !qualityOpen) setShowControls(false);
    }, 2600);
  }, [qualityOpen]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  /* ---------------- keyboard ---------------- */

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = videoRef.current;
      if (!el) return;
      const target = e.target as HTMLElement | null;
      // Don't hijack typing in the comment box.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      if (e.key === " " || e.key === "k") {
        e.preventDefault();
        togglePlay();
      } else if (e.key === "ArrowRight") {
        seekTo(el.currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        seekTo(el.currentTime - 5);
      } else if (e.key === "m") {
        toggleMute();
      } else if (e.key === "f") {
        void toggleFullscreen();
      }
      revealControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealControls, togglePlay]);

  /* ---------------- quality switching keeps position ---------------- */

  const pickQuality = (q: Quality) => {
    const el = videoRef.current;
    const at = el?.currentTime ?? 0;
    const wasPlaying = el ? !el.paused : false;
    setQuality(q);
    setQualityOpen(false);
    // The <video> reloads when src changes; restore position + play state.
    window.setTimeout(() => {
      const next = videoRef.current;
      if (!next) return;
      next.currentTime = at;
      if (wasPlaying) void next.play();
    }, 60);
  };

  const availableQualities = QUALITIES.filter(
    (q) => q === "auto" || Boolean(sources?.[q as Exclude<Quality, "auto">]),
  );

  const progress = duration > 0 ? (current / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? (buffered / duration) * 100 : 0;

  return (
    <div
      ref={wrapRef}
      className={`group relative w-full overflow-hidden bg-black ${
        // Drop the caller's styling (rounded corners, margins) in fullscreen so
        // the black backdrop reaches the screen edges.
        fullscreen ? "flex h-screen w-screen items-center justify-center" : className
      }`}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
    >
      {/* In fullscreen this becomes a phone-shaped 9:16 frame centred on black,
          so the player reads as portrait instead of stretching to the monitor. */}
      <div
        className={
          fullscreen
            ? "relative flex aspect-[9/16] h-full max-h-screen w-auto max-w-full items-center justify-center bg-black"
            : "relative w-full"
        }
      >
      <video
        ref={videoRef}
        src={activeSrc}
        poster={poster}
        playsInline
        preload="metadata"
        className={
          fullscreen
            ? "h-full w-full bg-black object-contain"
            : "aspect-video w-full bg-black"
        }
        onClick={togglePlay}
        onPlay={() => {
          setPlaying(true);
          revealControls();
          if (!started) {
            setStarted(true);
            onFirstPlay?.();
          }
        }}
        onPause={() => {
          setPlaying(false);
          setShowControls(true);
        }}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onDurationChange={(e) => setDuration(e.currentTarget.duration || 0)}
        onProgress={(e) => {
          const el = e.currentTarget;
          if (el.buffered.length > 0) setBuffered(el.buffered.end(el.buffered.length - 1));
        }}
        onVolumeChange={(e) => {
          setVolume(e.currentTarget.volume);
          setMuted(e.currentTarget.muted);
        }}
        onEnded={() => {
          setPlaying(false);
          setShowControls(true);
        }}
      />

      {/* Big center play button before the first play. */}
      {!playing && (
        <button
          type="button"
          onClick={togglePlay}
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center bg-black/20 transition hover:bg-black/30"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/70 text-white">
            <Play className="ml-1 h-8 w-8 fill-current" />
          </span>
        </button>
      )}

      {/* Control bar */}
      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-3 pb-2 pt-8 transition-opacity duration-200 ${
          showControls || !playing ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        {/* Seek bar */}
        <div className="relative mb-1.5 h-1 w-full rounded-full bg-white/30">
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/40"
            style={{ width: `${bufferedPct}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-red-600"
            style={{ width: `${progress}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 0}
            step={0.1}
            value={current}
            onChange={(e) => seekTo(Number(e.target.value))}
            aria-label="Seek"
            className="absolute inset-0 h-1 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-red-600"
          />
        </div>

        <div className="flex items-center gap-2 text-white">
          <button type="button" onClick={togglePlay} aria-label={playing ? "Pause" : "Play"} className="p-1">
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current" />}
          </button>

          <div className="flex items-center gap-1">
            <button type="button" onClick={toggleMute} aria-label={muted ? "Unmute" : "Mute"} className="p-1">
              {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={muted ? 0 : volume}
              onChange={(e) => {
                const el = videoRef.current;
                if (!el) return;
                el.volume = Number(e.target.value);
                el.muted = Number(e.target.value) === 0;
              }}
              aria-label="Volume"
              className="hidden h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/40 sm:block [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
            />
          </div>

          <span className="ml-1 text-[12px] tabular-nums text-white/90">
            {formatDuration(current)} / {formatDuration(duration)}
          </span>

          <div className="ml-auto flex items-center gap-1">
            {/* Quality menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setQualityOpen((v) => !v)}
                aria-label="Quality"
                aria-expanded={qualityOpen}
                className="flex items-center gap-1 p-1 text-[12px] font-semibold"
              >
                <Settings className="h-5 w-5" />
                <span className="hidden sm:inline">{quality === "auto" ? "Auto" : quality}</span>
              </button>
              {qualityOpen && (
                <div className="absolute bottom-9 right-0 min-w-28 overflow-hidden rounded-md bg-black/95 py-1 text-[13px] shadow-lg">
                  {availableQualities.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => pickQuality(q)}
                      className={`block w-full px-3 py-1.5 text-left hover:bg-white/15 ${
                        quality === q ? "font-bold text-red-500" : "text-white"
                      }`}
                    >
                      {q === "auto" ? "Auto" : q}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={() => void toggleFullscreen()}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="p-1"
            >
              {fullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
