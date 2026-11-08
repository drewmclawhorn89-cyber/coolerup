import { Download, Loader2, Lock, Trash2 } from "lucide-react";
import { formatBytes } from "@/lib/offline";
import { useFullVideoOffline } from "@/lib/useFullVideoOffline";
import type { FullVideo } from "@/lib/fullVideos";

/**
 * Save/remove control used on long-form video cards. Downloads land in the
 * shared offline library, so the watch page and share sheet see them too.
 */
export function FullVideoOfflineButton({ video }: { video: FullVideo }) {
  const { savedSize, progress, isSaved, offlineUnlocked, toggle } = useFullVideoOffline(video);

  const label =
    progress !== null
      ? `Saving ${progress}%`
      : isSaved
        ? `Remove offline · ${formatBytes(savedSize ?? 0)}`
        : offlineUnlocked
          ? "Download for offline"
          : "Offline · Plus";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        void toggle();
      }}
      disabled={progress !== null}
      aria-label={label}
      aria-pressed={isSaved}
      title={label}
      className="absolute left-1.5 top-1.5 z-10 flex min-h-8 max-w-[calc(100%-5rem)] items-center gap-1.5 rounded-full bg-black/75 px-2.5 text-[11px] font-medium text-white shadow-sm backdrop-blur transition hover:bg-black/90 disabled:opacity-80"
    >
      {progress !== null ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : isSaved ? (
        <Trash2 className="size-3.5" />
      ) : offlineUnlocked ? (
        <Download className="size-3.5" />
      ) : (
        <Lock className="size-3.5" />
      )}
      <span className="truncate">{label}</span>
    </button>
  );
}
