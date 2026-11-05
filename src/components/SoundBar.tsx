import { Link } from "@tanstack/react-router";
import { Music } from "lucide-react";

export type SoundBarProps = {
  soundId: string;
  /** Sound title, e.g. "Original sound - @drewmclawhorn3". */
  title: string;
  creatorUsername?: string | null;
  className?: string;
};

/**
 * TikTok-style sound bar that sits above the caption on a video card.
 * Tapping the marquee opens the sound page.
 *
 * Note: there is deliberately no "Original audio" toggle here. Once a post is
 * published with a different sound, that sound is the only audio a viewer
 * hears — the video/pic itself never shows a button to switch back to the
 * original audio.
 */
export function SoundBar({ soundId, title, creatorUsername, className = "" }: SoundBarProps) {
  const label = title?.trim() || `Original sound - @${creatorUsername ?? "creator"}`;

  return (
    <div className={`pointer-events-auto flex max-w-[85%] items-center gap-2 ${className}`}>
      <Link
        to="/sound/$soundId"
        params={{ soundId }}
        aria-label={`Open sound: ${label}`}
        className="flex min-w-0 items-center gap-1 rounded-full bg-black/35 px-1.5 py-0.5 backdrop-blur-sm transition hover:bg-black/50"
      >
        <Music className="h-3 w-3 shrink-0 text-white drop-shadow" aria-hidden />
        <span className="relative block w-[min(52vw,210px)] overflow-hidden">
          <span className="animate-marquee flex w-max text-white text-[11px] font-medium leading-4">
            <span className="whitespace-nowrap pr-8">{label}</span>
            <span aria-hidden className="whitespace-nowrap pr-8">
              {label}
            </span>
          </span>
        </span>
      </Link>
    </div>
  );
}
