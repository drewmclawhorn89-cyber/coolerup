import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  EyeOff,
  MoreVertical,
  Pause,
  Play,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { DirectMessage, DmMediaType } from "@/lib/dmMedia";

export type LightboxMediaItem = {
  id: string;
  url: string;
  mediaType: DmMediaType;
  fromUsername: string;
  caption?: string | null;
  viewOnce?: boolean;
  msg?: DirectMessage;
};

const SWIPE_THRESHOLD_PX = 48;

export function DmMediaLightbox({
  items,
  initialIndex,
  onClose,
  onOpenActions,
}: {
  items: LightboxMediaItem[];
  initialIndex: number;
  onClose: () => void;
  onOpenActions?: (item: LightboxMediaItem) => void;
}) {
  const [index, setIndex] = useState(() =>
    Math.max(0, Math.min(initialIndex, Math.max(0, items.length - 1))),
  );
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [dragX, setDragX] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  const current = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    setPaused(false);
  }, [index, current?.id]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && hasPrev) setIndex((i) => Math.max(0, i - 1));
      if (e.key === "ArrowRight" && hasNext) setIndex((i) => Math.min(items.length - 1, i + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasNext, hasPrev, items.length, onClose]);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    el.muted = muted;
  }, [muted, index]);

  if (!current) return null;

  const isVideo = current.mediaType === "video" || current.mediaType === "coolerup_video";

  const togglePlayPause = () => {
    const el = videoRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => {});
      setPaused(false);
    } else {
      el.pause();
      setPaused(true);
    }
  };

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = next;
    }
  };

  const goPrev = () => {
    if (hasPrev) setIndex((i) => Math.max(0, i - 1));
  };

  const goNext = () => {
    if (hasNext) setIndex((i) => Math.min(items.length - 1, i + 1));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black text-white select-none"
      role="dialog"
      aria-modal="true"
      aria-label="Full screen media viewer"
    >
      {/* Top Bar */}
      <div className="flex items-center justify-between gap-3 px-4 pb-2 pt-[calc(0.75rem+env(safe-area-inset-top))]">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-bold text-white">@{current.fromUsername}</p>
            {current.viewOnce && (
              <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary">
                <EyeOff className="h-3 w-3" />
                View Once
              </span>
            )}
          </div>
          {items.length > 1 && (
            <p className="text-[11px] text-white/60">
              {index + 1} of {items.length} · Swipe left or right
            </p>
          )}
        </div>

        <div className="flex items-center gap-2">
          {!current.viewOnce && onOpenActions && (
            <button
              type="button"
              onClick={() => onOpenActions(current)}
              aria-label="More media actions"
              className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
            >
              <MoreVertical className="h-5 w-5" />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close full screen viewer"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Media Stage with Horizontal Touch Swipe */}
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-2"
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (!t) return;
          touchStartX.current = t.clientX;
          touchStartY.current = t.clientY;
        }}
        onTouchMove={(e) => {
          if (touchStartX.current === null || touchStartY.current === null) return;
          const t = e.touches[0];
          if (!t) return;
          const dx = t.clientX - touchStartX.current;
          const dy = t.clientY - touchStartY.current;
          if (Math.abs(dx) > Math.abs(dy)) {
            setDragX(dx);
          }
        }}
        onTouchEnd={() => {
          if (dragX <= -SWIPE_THRESHOLD_PX && hasNext) {
            goNext();
          } else if (dragX >= SWIPE_THRESHOLD_PX && hasPrev) {
            goPrev();
          }
          touchStartX.current = null;
          touchStartY.current = null;
          setDragX(0);
        }}
      >
        {hasPrev && (
          <button
            type="button"
            onClick={goPrev}
            aria-label="Previous media"
            className="absolute left-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white border border-white/15 hover:bg-black/90"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        <div
          className="flex max-h-full max-w-full items-center justify-center transition-transform duration-150"
          style={{ transform: dragX ? `translateX(${dragX * 0.45}px)` : undefined }}
        >
          {isVideo ? (
            <video
              key={current.id}
              ref={videoRef}
              src={current.url}
              autoPlay
              playsInline
              loop
              muted={muted}
              onClick={togglePlayPause}
              onPlay={() => setPaused(false)}
              onPause={() => setPaused(true)}
              className="max-h-[76dvh] max-w-full rounded-xl object-contain"
            />
          ) : (
            <img
              key={current.id}
              src={current.url}
              alt={current.caption || `Photo from @${current.fromUsername}`}
              className="max-h-[78dvh] max-w-full rounded-xl object-contain"
            />
          )}
        </div>

        {hasNext && (
          <button
            type="button"
            onClick={goNext}
            aria-label="Next media"
            className="absolute right-3 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-black/70 text-white border border-white/15 hover:bg-black/90"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>

      {/* Bottom Controls (Video Pause + Mute, Caption) */}
      <div className="flex flex-col gap-3 px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-2">
        {current.caption && (
          <p className="mx-auto max-w-md text-center text-sm text-white/90">{current.caption}</p>
        )}

        {isVideo && (
          <div className="flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={paused ? "Play video" : "Pause video"}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/20 bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              <span>{paused ? "Play" : "Pause"}</span>
            </button>

            <button
              type="button"
              onClick={toggleMute}
              aria-label={muted ? "Unmute video" : "Mute video"}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-white/20 bg-zinc-900 px-5 text-sm font-semibold text-white hover:bg-zinc-800"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              <span>{muted ? "Unmute" : "Mute"}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
