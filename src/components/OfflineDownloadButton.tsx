import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Download, Loader2 } from "lucide-react";
import type { FullVideo } from "@/lib/fullVideos";
import {
  downloadFullVideo,
  isFullVideoDownloaded,
  onOfflineChange,
  removeDownloadedVideo,
} from "@/lib/offline";

/**
 * YouTube-style download control for a full-length video card.
 *
 * Three states, exactly like the YouTube app:
 *   • not saved  → "Download" with a ⬇️ icon
 *   • saving     → "Downloading 45%…" with a spinner
 *   • saved      → green "Downloaded ✓" badge (tap to remove)
 *
 * The bytes go into the `coolerup-videos` Cache Storage bucket and the metadata
 * into IndexedDB (see lib/offline.ts + lib/db.ts), so the video plays with no
 * connection at all.
 */
export function OfflineDownloadButton({
  video,
  className = "",
  onChanged,
}: {
  video: FullVideo;
  className?: string;
  onChanged?: () => void;
}) {
  const [downloaded, setDownloaded] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void isFullVideoDownloaded(video.id)
        .then((yes) => {
          if (alive) setDownloaded(yes);
        })
        .catch(() => {
          if (alive) setDownloaded(false);
        });
    };
    refresh();
    const off = onOfflineChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [video.id]);

  const busy = progress !== null;

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (busy) return;

    // Tapping an already-downloaded video frees the space again.
    if (downloaded) {
      try {
        await removeDownloadedVideo(video.id);
        setDownloaded(false);
        onChanged?.();
        toast.success("Removed download");
      } catch {
        toast.error("Couldn't remove this download");
      }
      return;
    }

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      toast.error("You're offline. Connect to download this video.");
      return;
    }

    setProgress(0);
    try {
      const size = await downloadFullVideo(video, setProgress);
      setDownloaded(true);
      onChanged?.();
      toast.success(`Downloaded for offline · ${(size / (1024 * 1024)).toFixed(1)} MB`);
    } catch (error) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Couldn't download this video.");
    } finally {
      setProgress(null);
    }
  };

  const label = busy
    ? progress && progress > 0
      ? `Downloading ${progress}%…`
      : "Downloading…"
    : downloaded
      ? "Downloaded"
      : "Download";

  return (
    <button
      type="button"
      onClick={(event) => void handleClick(event)}
      disabled={busy || video.status === "processing"}
      aria-label={
        downloaded ? `Remove download of ${video.title}` : `Download ${video.title} for offline`
      }
      aria-pressed={downloaded}
      title={downloaded ? "Downloaded — tap to remove" : "Download for offline"}
      className={`absolute bottom-1.5 left-1.5 z-10 flex min-h-7 items-center gap-1 rounded-full px-2 text-[11px] font-semibold shadow-sm backdrop-blur transition disabled:opacity-80 ${
        downloaded
          ? "bg-emerald-600 text-white hover:bg-emerald-700"
          : "bg-black/75 text-white hover:bg-black/90"
      } ${className}`}
    >
      {busy ? (
        <Loader2 className="size-3.5 shrink-0 animate-spin" />
      ) : downloaded ? (
        <CheckCircle2 className="size-3.5 shrink-0" />
      ) : (
        <Download className="size-3.5 shrink-0" />
      )}
      <span className="truncate tabular-nums">{label}</span>
    </button>
  );
}
