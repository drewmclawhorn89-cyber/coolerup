import { X } from "lucide-react";

import { GTA6Countdown } from "@/components/GTA6Countdown";
import { GTA6_DATE_LABEL, GTA6_HASHTAG } from "@/lib/gta6";

/**
 * The GTA 6 event banner, pinned to the top of For You.
 *
 * Neon sunset card with the headline, a live countdown to Nov 15 and a Post
 * button that opens the recorder. It disappears on its own when the event ends
 * (the parent only renders it while `useGTA6Mode()` is true), so there is
 * nothing to clean up after Nov 15.
 */
export function GTA6Banner({
  onPost,
  onDismiss,
  className = "",
}: {
  onPost: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  return (
    <div
      className={`gta6-banner relative mx-3 mb-2 flex shrink-0 items-center gap-2.5 rounded-2xl px-3 py-2.5 text-white shadow-lg md:mx-10 ${className}`}
      role="region"
      aria-label="GTA 6 update"
    >
      <span className="gta6-palm text-2xl" aria-hidden>
        🌴
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold leading-tight">GTA 6 Update — Only Until Nov 15! 🔥</p>
        <p className="text-[11px] font-bold leading-tight text-[#FFD9EC]">Never Coming Back!</p>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-white/85">
          <GTA6Countdown compact className="gta6-countdown-compact" />
          <span className="text-white/40" aria-hidden>
            •
          </span>
          <span>
            Post 10 with <strong className="text-white">{GTA6_HASHTAG}</strong> to win
          </span>
          <span className="text-white/40" aria-hidden>
            •
          </span>
          <span>{GTA6_DATE_LABEL}</span>
        </div>
      </div>
      <button
        type="button"
        onClick={onPost}
        className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-white/90"
      >
        Post
      </button>
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss GTA 6 banner"
          onClick={onDismiss}
          className="shrink-0 text-white/70 transition hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
