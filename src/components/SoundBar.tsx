import { Link } from "@tanstack/react-router";
import { Music } from "lucide-react";

export type SoundBarProps = {
  soundId: string;
  /** Sound title, e.g. "Original sound - @drewmclawhorn3". */
  title: string;
  creatorUsername?: string | null;
  className?: string;
  /** Whether the video's own audio is still audible under a borrowed sound. */
  originalAudio?: boolean;
  onToggleOriginalAudio?: () => void;
  showOriginalToggle?: boolean;
};

/**
 * TikTok-style sound bar that sits above the caption on a video card.
 * Tapping the marquee opens the sound page.
 */
export function SoundBar({
  soundId,
  title,
  creatorUsername,
  className = "",
  originalAudio = false,
  onToggleOriginalAudio,
  showOriginalToggle = false,
}: SoundBarProps) {
  const label = title?.trim() || `Original sound - @${creatorUsername ?? "creator"}`;

  return (
    <div className={`pointer-events-auto flex max-w-[85%] items-center gap-2 ${className}`}>
      <Link
        to="/sound/$soundId"
        params={{ soundId }}
        aria-label={`Open sound: ${label}`}
        className="flex min-w-0 items-center gap-1.5 rounded-full bg-black/35 px-2 py-1 backdrop-blur-sm transition hover:bg-black/50"
      >
        <Music className="h-3.5 w-3.5 shrink-0 text-white drop-shadow" aria-hidden />
        <span className="relative block w-[min(52vw,210px)] overflow-hidden">
          <span className="animate-marquee flex w-max text-white text-[13px] font-semibold">
            <span className="whitespace-nowrap pr-8">{label}</span>
            <span aria-hidden className="whitespace-nowrap pr-8">
              {label}
            </span>
          </span>
        </span>
      </Link>

      {showOriginalToggle && onToggleOriginalAudio && (
        <button
          type="button"
          onClick={onToggleOriginalAudio}
          aria-pressed={originalAudio}
          title="Keep the video's original audio under the sound"
          className="flex shrink-0 items-center gap-1 rounded-full bg-black/35 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm transition hover:bg-black/50"
        >
          <span
            className={`flex h-3.5 w-3.5 items-center justify-center rounded-[3px] border ${
              originalAudio ? "border-white bg-white text-black" : "border-white/70"
            }`}
          >
            {originalAudio ? (
              <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" aria-hidden>
                <path
                  d="M2 6.2 4.6 8.8 10 3.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            ) : null}
          </span>
          Original audio
        </button>
      )}
    </div>
  );
}
