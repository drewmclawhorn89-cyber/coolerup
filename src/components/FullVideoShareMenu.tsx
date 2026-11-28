import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Check, Copy, Download, Loader2, Lock, Share2, Trash2, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/offline";
import { useFullVideoOffline } from "@/lib/useFullVideoOffline";
import { resolveFullVideoUrl, type FullVideo } from "@/lib/fullVideos";
import { OfflinePaywallDialog } from "@/components/OfflinePaywallDialog";
import { closeBottomSheetOverlay, openBottomSheetOverlay } from "@/lib/commentsOverlay";
import {
  downloadExtension,
  prepareWatermarkedFile,
  saveFileToDisk,
  WatermarkError,
  watermarkCause,
} from "@/lib/watermark";

/**
 * Share sheet for long-form videos (the /videos tab and the watch page).
 *
 * Besides sharing and downloading a file, it carries the Offline mode action
 * so a viewer can save the video for offline viewing right from Share.
 */
export function FullVideoShareMenu({
  video,
  onClose,
  onShared,
}: {
  video: FullVideo;
  onClose: () => void;
  onShared?: () => void;
}) {
  const { savedSize, progress, isSaved, offlineUnlocked, paywallOpen, closePaywall, toggle } =
    useFullVideoOffline(video);

  const url = typeof window !== "undefined" ? `${window.location.origin}/watch/${video.id}` : "";

  useEffect(() => {
    openBottomSheetOverlay();
    return () => {
      closeBottomSheetOverlay();
    };
  }, []);

  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: video.title || "Coolerup video", url });
        onShared?.();
        onClose();
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
        onClose();
      }
    } catch {
      /* user dismissed the share sheet */
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied");
    } catch {
      toast.error("Couldn't copy the link");
    }
  };

  const download = async () => {
    const t = toast.loading("Preparing download…");
    try {
      const src = await resolveFullVideoUrl(video.video_url);
      if (!src) throw new Error("No video URL");
      const resp = await fetch(src);
      if (!resp.ok) throw new Error("Network response was not ok");
      const blob = await resp.blob();
      const ext = downloadExtension(src, blob);
      const filename = `${video.id}.${ext}`;

      // Smart detection preserves existing stamps; clean videos must be marked.
      const file = await prepareWatermarkedFile({
        blob,
        username: video.username,
        filename,
        onProgress: ({ percent, stage }) => toast.loading(`${stage}… ${percent}%`, { id: t }),
      });

      // On phones the share sheet is the way to save to the camera roll / Files.
      const isTouch =
        typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isTouch && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          toast.success("Saved", { id: t });
          onShared?.();
          return;
        } catch (e) {
          if (e instanceof DOMException && e.name === "AbortError") {
            toast.dismiss(t);
            return;
          }
        }
      }

      saveFileToDisk(file);
      toast.success("Download started", { id: t });
      onShared?.();
    } catch (err) {
      console.error("Download failed:", watermarkCause(err) || err);
      toast.error(
        err instanceof WatermarkError
          ? `Couldn't watermark this video, so the download was cancelled.${watermarkCause(err) ? ` (${watermarkCause(err)})` : ""}`
          : "Couldn't download this video. Try again.",
        { id: t },
      );
    }
  };

  const offlineLabel =
    progress !== null
      ? `Saving ${progress}%`
      : isSaved
        ? `Saved · ${formatBytes(savedSize ?? 0)}`
        : offlineUnlocked
          ? "Save offline"
          : "Offline · Paid";

  const content = (
    <div
      className="fixed inset-0 z-[90] bg-black/55"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share video"
    >
      <aside
        style={{
          backgroundColor: "var(--background)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        }}
        className="sheet-up fixed bottom-0 left-0 z-[91] w-screen overflow-hidden rounded-t-2xl border-t border-white/20 bg-background px-3 pt-4 text-white sm:left-1/2 sm:max-w-md sm:-translate-x-1/2"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-1 pb-4">
          <h2 className="text-base font-bold text-white">Share</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share menu"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid grid-cols-4 gap-x-2 gap-y-4 pt-1">
          <button
            type="button"
            className="flex w-full flex-col items-center gap-2 text-center"
            onClick={() => void share()}
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
              <Share2 className="h-6 w-6" />
            </div>
            <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
              Share
            </span>
          </button>

          <button
            type="button"
            className="flex w-full flex-col items-center gap-2 text-center"
            onClick={() => void copyLink()}
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
              <Copy className="h-6 w-6" />
            </div>
            <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
              Copy link
            </span>
          </button>

          <button
            type="button"
            className="flex w-full flex-col items-center gap-2 text-center"
            onClick={() => void download()}
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
              <Download className="h-6 w-6" />
            </div>
            <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
              Download
            </span>
          </button>

          <button
            type="button"
            className="flex w-full flex-col items-center gap-2 text-center"
            onClick={() => void toggle()}
            disabled={progress !== null}
            aria-pressed={isSaved}
            aria-label={offlineLabel}
          >
            <div
              className={`flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 text-white ${
                isSaved ? "bg-emerald-600" : "bg-white/15"
              }`}
            >
              {progress !== null ? (
                <Loader2 className="h-6 w-6 animate-spin" />
              ) : isSaved ? (
                <Check className="h-6 w-6" />
              ) : offlineUnlocked ? (
                <WifiOff className="h-6 w-6" />
              ) : (
                <Lock className="h-6 w-6" />
              )}
            </div>
            <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
              {offlineLabel}
            </span>
          </button>
        </div>

        {progress !== null && (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        {isSaved && (
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={progress !== null}
            className="mx-auto mt-4 flex items-center gap-1.5 text-xs font-medium text-red-400"
          >
            <Trash2 size={14} /> Remove from offline
          </button>
        )}
      </aside>

      <OfflinePaywallDialog open={paywallOpen} onClose={closePaywall} />
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}
