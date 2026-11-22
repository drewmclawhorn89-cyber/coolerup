import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  Maximize,
  Minimize,
  Pause,
  Play,
  RotateCw,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react";
import { formatDuration } from "@/lib/fullVideos";
import { createWatchDurationTracker } from "@/lib/watchHistory";

export type Quality = "1080p" | "720p" | "480p" | "auto";

/** Quarter turns, in degrees, that the video can be rotated by in fullscreen. */
type Rotation = 0 | 90 | 180 | 270;

const QUALITIES: Quality[] = ["auto", "1080p", "720p", "480p"];

export type YouTubePlayerProps = {
  /** Resolved (signed) URL for the default rendition. */
  src: string;
  /** Optional per-rendition URLs; a quality is only offered when it exists. */
  sources?: Partial<Record<Exclude<Quality, "auto">, string | null>> | undefined;
  poster?: string | undefined;
  /** Called once, the first time playback actually starts. */
  onFirstPlay?: () => void;
  /** Called once after >3 seconds of active playback. */
  onWatchThreshold?: () => void;
  className?: string;
};

/**
 * A YouTube-style player: click-to-play, a scrub bar with buffered range, a
 * volume slider, a quality menu and a fullscreen toggle.
 *
 * Deliberately not the TikTok player — no autoplay-on-scroll, no swipe. The
 * controls sit on top of the video and fade out while playing.
 */
export function YouTubePlayer({
  src,
  sources,
  poster,
  onFirstPlay,
  onWatchThreshold,
  className = "",
}: YouTubePlayerProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  /** The stage the video sits in while fullscreen. Measured so a rotated video
   *  can be sized to fill it exactly. */
  const frameRef = useRef<HTMLDivElement>(null);

  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  /** Fallback for browsers that refuse element fullscreen (iOS Safari): a
   *  fixed, black, edge-to-edge overlay that behaves like the real thing. */
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false);
  const isFullscreen = fullscreen || pseudoFullscreen;
  const [showControls, setShowControls] = useState(true);
  const [quality, setQuality] = useState<Quality>("auto");
  const [qualityOpen, setQualityOpen] = useState(false);
  const [started, setStarted] = useState(false);
  const [rotation, setRotation] = useState<Rotation>(0);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  const hideTimer = useRef<number | null>(null);
  const onWatchThresholdRef = useRef(onWatchThreshold);
  onWatchThresholdRef.current = onWatchThreshold;
  const watchTrackerRef = useRef<ReturnType<typeof createWatchDurationTracker> | null>(null);

  useEffect(() => {
    const tracker = createWatchDurationTracker({
      onTrigger: () => {
        onWatchThresholdRef.current?.();
      },
    });
    watchTrackerRef.current = tracker;
    return () => {
      tracker.dispose();
      if (watchTrackerRef.current === tracker) watchTrackerRef.current = null;
    };
  }, [src]);

  /** Which URL should actually be playing right now. */
  const activeSrc = quality !== "auto" && sources?.[quality] ? (sources[quality] as string) : src;

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

  const toggleFullscreen = useCallback(async () => {
    // Leaving the fallback overlay is a pure state change.
    if (pseudoFullscreen) {
      setPseudoFullscreen(false);
      setRotation(0);
      return;
    }
    const el = wrapRef.current;
    if (!el) return;
    try {
      if (!document.fullscreenElement) {
        await el.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // iOS Safari refuses fullscreen on non-video elements. Rather than hand
      // control to the native player, show the same black edge-to-edge stage
      // with our own controls so every device looks identical.
      setPseudoFullscreen(true);
    }
  }, [pseudoFullscreen]);

  useEffect(() => {
    const onFsChange = () => {
      const active = Boolean(document.fullscreenElement);
      setFullscreen(active);
      // Rotation only makes sense inside the fullscreen frame.
      if (!active) setRotation(0);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  /* ---------------- fullscreen stage: no page scroll behind it ---------------- */

  useEffect(() => {
    if (!isFullscreen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isFullscreen]);

  // Read inside timers/callbacks without re-creating them on every toggle.
  const isFullscreenRef = useRef(isFullscreen);
  isFullscreenRef.current = isFullscreen;

  /** Step the video a quarter turn each tap. */
  const rotateVideo = useCallback(() => {
    setRotation((r) => ((r + 90) % 360) as Rotation);
  }, []);

  /* ---------------- fullscreen frame measurement ---------------- */

  // A rotated video is drawn wider than the stage, so we need its exact pixel
  // size to swap width/height and fill it edge to edge.
  useEffect(() => {
    if (!isFullscreen) return;
    const el = frameRef.current;
    if (!el) return;
    const update = () => setFrameSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isFullscreen]);

  /* ---------------- controls visibility ---------------- */

  const revealControls = useCallback(() => {
    setShowControls(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      // Never hide the bar while the quality menu is open.
      if (qualityOpen) return;
      // In fullscreen nothing but the video may stay on screen, so the chrome
      // always goes away after 3s — paused or not. Outside fullscreen a paused
      // video keeps its controls visible.
      if (isFullscreenRef.current) setShowControls(false);
      else if (videoRef.current && !videoRef.current.paused) setShowControls(false);
    }, 3000);
  }, [qualityOpen]);

  useEffect(() => {
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  // Entering fullscreen starts the 3s countdown right away, so a touch device
  // (where no mousemove fires) still ends up with nothing but the video.
  useEffect(() => {
    if (!isFullscreen) return;
    revealControls();
  }, [isFullscreen, revealControls]);

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
      } else if (e.key === "Escape" && pseudoFullscreen) {
        // The browser handles Escape for real fullscreen; the fallback stage
        // has to close itself.
        setPseudoFullscreen(false);
        setRotation(0);
      } else if (e.key === "ArrowRight") {
        seekTo(el.currentTime + 5);
      } else if (e.key === "ArrowLeft") {
        seekTo(el.currentTime - 5);
      } else if (e.key === "m") {
        toggleMute();
      } else if (e.key === "f") {
        void toggleFullscreen();
      } else if (e.key === "r") {
        rotateVideo();
      }
      revealControls();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealControls, togglePlay, rotateVideo, toggleFullscreen, pseudoFullscreen]);

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

  /**
   * Whether the play button and control bar are on screen. In fullscreen the
   * chrome only appears on tap / mouse move and then disappears again, so the
   * screen holds nothing but the video. Outside fullscreen a paused video
   * keeps its controls.
   */
  const chromeVisible = showControls || (!isFullscreen && !playing);

  const quarterTurn = rotation === 90 || rotation === 270;

  /**
   * Rotation only applies in fullscreen. A quarter turn swaps the video's
   * width and height to the stage's, so the rotated picture still fills the
   * screen instead of leaving black bars. A half turn just flips in place.
   */
  const videoStyle: CSSProperties = {};
  if (isFullscreen && rotation !== 0) {
    if (quarterTurn) {
      if (frameSize.w > 0 && frameSize.h > 0) {
        Object.assign(videoStyle, {
          position: "absolute",
          left: "50%",
          top: "50%",
          width: frameSize.h,
          height: frameSize.w,
          transform: `translate(-50%, -50%) rotate(${rotation}deg)`,
          transition: "transform 200ms ease",
        });
      }
    } else {
      Object.assign(videoStyle, {
        transform: `rotate(${rotation}deg)`,
        transition: "transform 200ms ease",
      });
    }
  }

  return (
    <div
      ref={wrapRef}
      className={`group overflow-hidden bg-black ${
        // True fullscreen: a pure-black stage covering the whole viewport, on
        // top of every piece of app chrome (tabs, rails, Up Next). The caller's
        // styling (rounded corners, margins) is dropped so nothing shows but
        // the video.
        isFullscreen
          ? "fixed inset-0 z-[100] flex h-[100dvh] w-screen items-center justify-center"
          : `relative w-full ${className}`
      }`}
      onMouseMove={revealControls}
      onTouchStart={revealControls}
    >
      {/* The stage is exactly the viewport: no letterboxing, no frame. */}
      <div
        ref={frameRef}
        className={isFullscreen ? "relative h-full w-full bg-black" : "relative w-full"}
      >
        <video
          ref={videoRef}
          src={activeSrc}
          poster={poster}
          playsInline
          preload="metadata"
          style={videoStyle}
          className={
            isFullscreen ? "h-full w-full bg-black object-cover" : "aspect-video w-full bg-black"
          }
          onClick={() => {
            revealControls();
            togglePlay();
          }}
          onPlay={() => {
            setPlaying(true);
            revealControls();
            watchTrackerRef.current?.start();
            if (!started) {
              setStarted(true);
              onFirstPlay?.();
            }
          }}
          onPause={() => {
            setPlaying(false);
            revealControls();
            watchTrackerRef.current?.pause();
          }}
          onTimeUpdate={(e) => {
            setCurrent(e.currentTarget.currentTime);
            if (!e.currentTarget.paused) watchTrackerRef.current?.tick();
          }}
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
            revealControls();
            watchTrackerRef.current?.pause();
          }}
        />

        {/* Big center play button before the first play. */}
        {!playing && chromeVisible && (
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
            chromeVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          {/* Seek bar */}
          <div className="relative mb-1.5 h-1 w-full rounded-full bg-white/30">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white/40"
              style={{ width: `${bufferedPct}%` }}
            />
            <div
              className={`absolute inset-y-0 left-0 rounded-full ${
                isFullscreen ? "bg-white" : "bg-red-600"
              }`}
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
              className={`absolute inset-0 h-1 w-full cursor-pointer appearance-none bg-transparent [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full ${
                isFullscreen
                  ? "[&::-webkit-slider-thumb]:bg-white"
                  : "[&::-webkit-slider-thumb]:bg-red-600"
              }`}
            />
          </div>

          <div className="flex items-center gap-2 text-white">
            <button
              type="button"
              onClick={togglePlay}
              aria-label={playing ? "Pause" : "Play"}
              className="p-1"
            >
              {playing ? (
                <Pause className="h-5 w-5 fill-current" />
              ) : (
                <Play className="h-5 w-5 fill-current" />
              )}
            </button>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={toggleMute}
                aria-label={muted ? "Unmute" : "Mute"}
                className="p-1"
              >
                {muted || volume === 0 ? (
                  <VolumeX className="h-5 w-5" />
                ) : (
                  <Volume2 className="h-5 w-5" />
                )}
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
                          quality === q
                            ? `font-bold ${isFullscreen ? "text-white" : "text-red-500"}`
                            : "text-white"
                        }`}
                      >
                        {q === "auto" ? "Auto" : q}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {isFullscreen && (
                <button
                  type="button"
                  onClick={rotateVideo}
                  aria-label="Rotate video"
                  title="Rotate video"
                  className="p-1"
                >
                  <RotateCw className="h-5 w-5" />
                </button>
              )}

              <button
                type="button"
                onClick={() => void toggleFullscreen()}
                aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
                className="p-1"
              >
                {isFullscreen ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
