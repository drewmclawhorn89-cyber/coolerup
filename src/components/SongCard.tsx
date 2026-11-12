import { Heart, Music2, Pause, Play } from "lucide-react";
import {
  formatDuration,
  formatPlays,
  getKnownDuration,
  isYouTubeSound,
  soundCoverGradient,
  soundCoverUrl,
  type Sound,
} from "@/lib/sounds";

/**
 * Cover art for a sound.
 *
 * `sounds` has no `cover_url` column, so instead of inventing images we render
 * a stable gradient derived from the sound id. Same song = same cover, no
 * network request, and it looks deliberate rather than broken.
 */
export function SoundCover({
  sound,
  className = "",
  rounded = "rounded-xl",
}: {
  sound: Pick<Sound, "id" | "title" | "cover_url" | "youtube_url">;
  className?: string;
  rounded?: string;
}) {
  const initial = (sound.title || "?")
    .replace(/^Original sound.*/i, "♪")
    .trim()
    .charAt(0)
    .toUpperCase();
  const cover = soundCoverUrl(sound);
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${rounded} ${className}`}
      style={{ background: soundCoverGradient(sound.id) }}
      aria-hidden="true"
    >
      {cover ? (
        // YouTube thumbnail (or any real cover) — the gradient shows while it loads.
        <img
          src={cover}
          alt=""
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <span className="text-2xl font-black text-white/90 drop-shadow-sm">{initial}</span>
      )}
      <Music2 className="absolute bottom-1 right-1 h-3 w-3 text-white/60 drop-shadow" />
    </div>
  );
}

/** The little "▶ YouTube" pill shown on YouTube song cards and rows. */
export function YouTubeBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow-sm ${className}`}
      title="Plays from YouTube"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true" className="h-2.5 w-2.5" fill="currentColor">
        <path d="M23 12s0-3.4-.44-5.03a2.6 2.6 0 0 0-1.83-1.84C19.1 4.7 12 4.7 12 4.7s-7.1 0-8.73.43A2.6 2.6 0 0 0 1.44 6.97C1 8.6 1 12 1 12s0 3.4.44 5.03a2.6 2.6 0 0 0 1.83 1.84c1.63.43 8.73.43 8.73.43s7.1 0 8.73-.43a2.6 2.6 0 0 0 1.83-1.84C23 15.4 23 12 23 12ZM9.75 15.5v-7l6 3.5-6 3.5Z" />
      </svg>
      YouTube
    </span>
  );
}

/** Small "Full song" / "0:42" pill. */
export function DurationBadge({ soundId }: { soundId: string }) {
  const seconds = getKnownDuration(soundId);
  if (typeof seconds !== "number" || seconds <= 0) return null;
  const full = seconds >= 25;
  return (
    <span className="rounded-full bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-white backdrop-blur">
      {full ? `Full song · ${formatDuration(seconds)}` : formatDuration(seconds)}
    </span>
  );
}

/**
 * Horizontal-scroll card used by the "Top Songs" / "Trending" / "Your Sounds"
 * rows. Cover on top, title + artist + plays underneath.
 */
export function SongCard({
  sound,
  onOpen,
  saved = false,
  onToggleSave,
  playing = false,
}: {
  sound: Sound;
  onOpen: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  playing?: boolean;
}) {
  return (
    <div className="group relative w-32 shrink-0">
      <button
        type="button"
        onClick={onOpen}
        className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Play ${sound.title}`}
      >
        <div className="relative">
          <SoundCover sound={sound} className="aspect-square w-full" rounded="rounded-2xl" />
          {isYouTubeSound(sound) && (
            <span className="absolute left-1.5 top-1.5">
              <YouTubeBadge />
            </span>
          )}
          <span className="absolute bottom-1.5 left-1.5">
            <DurationBadge soundId={sound.id} />
          </span>
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white opacity-0 backdrop-blur transition group-hover:opacity-100">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
            </span>
          </span>
        </div>
        <p className="mt-1.5 truncate text-[13px] font-semibold leading-tight">{sound.title}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {isYouTubeSound(sound) ? sound.creator_username : `@${sound.creator_username}`}
        </p>
        <p className="truncate text-[11px] text-muted-foreground/70">
          {formatPlays(sound.uses_count)}
        </p>
      </button>
      {onToggleSave && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleSave();
          }}
          aria-label={saved ? "Remove from Your Sounds" : "Save to Your Sounds"}
          className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur"
        >
          <Heart className={`h-3.5 w-3.5 ${saved ? "fill-red-500 text-red-500" : ""}`} />
        </button>
      )}
    </div>
  );
}

/** Full-width row used by the "Full Songs" list. */
export function SongRow({
  sound,
  onOpen,
  saved = false,
  onToggleSave,
  playing = false,
  index,
}: {
  sound: Sound;
  onOpen: () => void;
  saved?: boolean;
  onToggleSave?: () => void;
  playing?: boolean;
  index?: number;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl p-1.5 hover:bg-white/5">
      {typeof index === "number" && (
        <span className="w-4 shrink-0 text-center text-xs tabular-nums text-muted-foreground">
          {index + 1}
        </span>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label={`Play ${sound.title}`}
      >
        <div className="relative shrink-0">
          <SoundCover sound={sound} className="h-12 w-12" rounded="rounded-lg" />
          <span className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/40 opacity-0 transition hover:opacity-100">
            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 fill-current" />}
          </span>
        </div>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{sound.title}</span>
            {isYouTubeSound(sound) && <YouTubeBadge />}
            <DurationBadge soundId={sound.id} />
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {isYouTubeSound(sound) ? sound.creator_username : `@${sound.creator_username}`} ·{" "}
            {formatPlays(sound.uses_count)}
          </span>
        </span>
      </button>
      {onToggleSave && (
        <button
          type="button"
          onClick={onToggleSave}
          aria-label={saved ? "Remove from Your Sounds" : "Save to Your Sounds"}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-white/10"
        >
          <Heart
            className={`h-4 w-4 ${saved ? "fill-red-500 text-red-500" : "text-muted-foreground"}`}
          />
        </button>
      )}
    </div>
  );
}
