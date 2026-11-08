import { Check, Copy, Download, Loader2, Lock, Share2, Trash2, WifiOff, X } from "lucide-react";
import { toast } from "sonner";
import { formatBytes } from "@/lib/offline";
import { useFullVideoOffline } from "@/lib/useFullVideoOffline";
import { resolveFullVideoUrl, type FullVideo } from "@/lib/fullVideos";
import { offlinePlan } from "@/lib/subscriptions";

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
  const { savedSize, progress, isSaved, offlineUnlocked, trialActive, trialLabel, toggle } =
    useFullVideoOffline(video);

  const url = typeof window !== "undefined" ? `${window.location.origin}/watch/${video.id}` : "";

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
      const extMatch = (video.video_url || "").match(/\.([a-z0-9]{2,4})(?:[?#]|$)/i);
      const ext = extMatch?.[1] ?? (blob.type.includes("webm") ? "webm" : "mp4");
      const filename = `${video.id}.${ext}`;
      const file = new File([blob], filename, { type: blob.type || `video/${ext}` });

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

      const href = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 10000);
      toast.success("Download started", { id: t });
      onShared?.();
    } catch (err) {
      console.error(err);
      toast.error("Couldn't download this video. Try again.", { id: t });
    }
  };

  const offlineLabel =
    progress !== null
      ? `Saving ${progress}%`
      : isSaved
        ? `Saved · ${formatBytes(savedSize ?? 0)}`
        : offlineUnlocked
          ? trialActive
            ? `Trial · ${trialLabel}`
            : "Offline mode"
          : `${offlinePlan().label} only`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share video"
    >
      <div
        className="w-full max-w-md space-y-5 rounded-t-2xl bg-zinc-900 p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-white">Share</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share menu"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-800 text-white"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-4 pt-2">
          <button
            type="button"
            className="flex flex-col items-center gap-2"
            onClick={() => void share()}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-white">
              <Share2 size={22} />
            </div>
            <span className="text-xs text-zinc-300">Share</span>
          </button>

          <button
            type="button"
            className="flex flex-col items-center gap-2"
            onClick={() => void copyLink()}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-white">
              <Copy size={22} />
            </div>
            <span className="text-xs text-zinc-300">Copy link</span>
          </button>

          <button
            type="button"
            className="flex flex-col items-center gap-2"
            onClick={() => void download()}
          >
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-white">
              <Download size={22} />
            </div>
            <span className="text-xs text-zinc-300">Download</span>
          </button>

          <button
            type="button"
            className="flex flex-col items-center gap-2"
            onClick={() => void toggle()}
            disabled={progress !== null}
            aria-pressed={isSaved}
            aria-label={offlineLabel}
          >
            <div
              className={`flex h-14 w-14 items-center justify-center rounded-full text-white ${
                isSaved ? "bg-emerald-600" : !offlineUnlocked ? "bg-zinc-800/60" : "bg-zinc-800"
              }`}
            >
              {progress !== null ? (
                <Loader2 size={22} className="animate-spin" />
              ) : isSaved ? (
                <Check size={22} />
              ) : offlineUnlocked ? (
                <WifiOff size={22} />
              ) : (
                <Lock size={22} />
              )}
            </div>
            <span className="max-w-[5rem] truncate text-xs text-zinc-300">{offlineLabel}</span>
          </button>
        </div>

        {progress !== null && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-800">
            <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        {isSaved && (
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={progress !== null}
            className="mx-auto flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300"
          >
            <Trash2 size={14} /> Remove from offline
          </button>
        )}

        <div className="pt-2 text-center text-xs text-zinc-500">{url}</div>
      </div>
    </div>
  );
}
