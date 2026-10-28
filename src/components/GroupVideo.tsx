import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * Inline player for videos posted inside groups.
 *
 * Group posts are a feed, so videos should just play as you scroll past them
 * (muted, like every other short-video feed) instead of sitting on a static
 * poster frame waiting for a tap. Tapping toggles sound; tapping again pauses.
 */
export function GroupVideo({
  src,
  className = "",
  poster,
}: {
  src: string;
  className?: string;
  poster?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  // Autoplay only while the clip is actually on screen, so a long group feed
  // doesn't end up with a dozen videos decoding at once.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            void el.play().catch(() => {
              /* autoplay blocked until the user interacts — the tap handler covers it */
            });
          } else if (!el.paused) {
            el.pause();
          }
        }
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [src]);

  useEffect(() => {
    const el = ref.current;
    if (el) el.muted = muted;
  }, [muted]);

  const toggleSound = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      el.muted = false;
      setMuted(false);
      void el.play().catch(() => undefined);
      return;
    }
    setMuted((m) => !m);
  };

  if (failed) {
    return (
      <div className={`flex h-48 items-center justify-center bg-black text-[12px] text-gray-400 ${className}`}>
        This video couldn't be loaded.
      </div>
    );
  }

  return (
    <div className={`relative bg-black ${className}`}>
      <video
        ref={ref}
        src={src}
        poster={poster}
        playsInline
        loop
        muted={muted}
        preload="metadata"
        controls={false}
        onClick={toggleSound}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onError={() => setFailed(true)}
        className="max-h-[70vh] w-full bg-black object-contain"
      />
      <button
        type="button"
        onClick={toggleSound}
        aria-label={muted ? "Unmute video" : "Mute video"}
        className="absolute bottom-3 right-3 rounded-full bg-black/70 p-2 text-white backdrop-blur"
      >
        {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
      </button>
      {!playing && (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded-full bg-black/60 px-3 py-1.5 text-[12px] font-bold text-white">
            Tap to play
          </span>
        </span>
      )}
    </div>
  );
}
