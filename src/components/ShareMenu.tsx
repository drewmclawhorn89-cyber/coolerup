import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Download, Flag, Gauge, Link2, Lock, Pencil, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { deleteVideo, resolveVideoUrl, type Video } from "@/lib/loop";
import { getSaved, removeOffline, saveOffline } from "@/lib/offline";
import { useOfflineUnlocked } from "@/lib/subscriptions";
import { OfflinePaywallDialog } from "@/components/OfflinePaywallDialog";
import { EditVideoDialog } from "@/components/EditVideoDialog";
import { closeBottomSheetOverlay, openBottomSheetOverlay } from "@/lib/commentsOverlay";
import {
  downloadExtension,
  prepareWatermarkedFile,
  saveFileToDisk,
  WatermarkError,
  watermarkCause,
} from "@/lib/watermark";

export function ShareMenu({
  video,
  onClose,
  onShared,
  onDeleted,
  qualityLabel,
  onOpenQuality,
  onReport,
  onEdited,
}: {
  video: Video;
  onClose: () => void;
  onShared: () => void;
  onDeleted?: () => void;
  qualityLabel?: string;
  onOpenQuality?: () => void;
  /** Opens the report flow. Report lives here now instead of on the action rail. */
  onReport?: (() => void) | undefined;
  /** Patch the card in place after the owner edits the clip or its details. */
  onEdited?:
    | ((next: {
        caption: string;
        username?: string;
        sound_id?: string | null;
        is_paid?: boolean;
        price_cents?: number | null;
        video_url?: string;
      }) => void)
    | undefined;
}) {
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const auth = useAuth();
  const [paywallOpen, setPaywallOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  // Offline mode is a paid feature — no trial, no downloads without a plan.
  const offlineUnlocked = useOfflineUnlocked(auth.handle);
  const isOwner = !!auth.user && !!auth.handle && auth.handle === video.username;
  const url = typeof window !== "undefined" ? `${window.location.origin}/v/${video.id}` : "";

  // Hide the main bottom navigation whenever the Share sheet is mounted.
  useEffect(() => {
    openBottomSheetOverlay();
    return () => {
      closeBottomSheetOverlay();
    };
  }, []);

  useEffect(() => {
    getSaved(video.id)
      .then((s) => setSavedSize(s?.size ?? null))
      .catch(() => {});
  }, [video.id]);

  const save = async () => {
    // Paid subscribers only — nothing is downloaded for anyone else.
    if (!offlineUnlocked) {
      setPaywallOpen(true);
      return;
    }
    setProgress(0);
    try {
      const size = await saveOffline(video, setProgress);
      setSavedSize(size);
      toast.success("Saved for offline viewing");
    } catch {
      toast.error("Couldn't save this video. Check your connection.");
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    await removeOffline(video.id);
    setSavedSize(null);
    toast.success("Removed from offline");
  };

  const deleteMine = async () => {
    if (!window.confirm("Delete this video? This can't be undone.")) return;
    try {
      await deleteVideo(video);
      toast.success("Video deleted");
      onDeleted?.();
      onClose();
    } catch {
      toast.error("Couldn't delete this video.");
    }
  };

  const download = async () => {
    const t = toast.loading("Preparing download…");
    try {
      const src = await resolveVideoUrl(video.video_url);
      if (!src) throw new Error("No video URL");
      const resp = await fetch(src);
      if (!resp.ok) throw new Error("Network response was not ok");
      const blob = await resp.blob();
      const ext = downloadExtension(src, blob);
      const filename = `${video.id}.${ext}`;

      // Smart detection preserves existing stamps; clean videos must be marked.
      const file = await prepareWatermarkedFile({
        blob,
        username: video.poster_username ?? video.username,
        filename,
        onProgress: ({ percent, stage }) => toast.loading(`${stage}… ${percent}%`, { id: t }),
      });

      // On phones, the share sheet is the way to save to the camera roll / Files.
      const isTouch =
        typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isTouch && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          toast.success("Saved", { id: t });
          onShared();
          return;
        } catch (e) {
          if (e instanceof Error && e.name === "AbortError") {
            toast.dismiss(t);
            return;
          }
        }
      }

      saveFileToDisk(file);
      toast.success("Download started", { id: t });
      onShared();
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

  const offlineLabel = savedSize ? "Remove" : offlineUnlocked ? "Save offline" : "Offline · Paid";

  const content = (
    <div
      className="fixed inset-0 z-[90] bg-black/55"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Share"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--background)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 16px)",
        }}
        className="sheet-up fixed bottom-0 left-0 z-[91] w-screen overflow-hidden rounded-t-2xl border-t border-white/20 bg-background px-3 pt-4 text-white sm:left-1/2 sm:max-w-md sm:-translate-x-1/2"
      >
        <header className="flex items-center justify-between px-1 pb-4">
          <h2 className="text-base font-bold text-white">Share</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="grid grid-cols-4 grid-rows-2 gap-x-2 gap-y-4 pt-1">
          {/* Row 1: Share | Copy link | Download | Save offline */}
          <button
            type="button"
            className="col-start-1 row-start-1 flex w-full flex-col items-center gap-2 text-center"
            onClick={async () => {
              if (navigator.share) {
                try {
                  await navigator.share({ title: "CoolerUp", url });
                  onShared();
                } catch {
                  /* user dismissed the share sheet - not an error */
                }
              } else {
                await navigator.clipboard.writeText(url);
                toast.success("Link copied");
              }
            }}
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
            className="col-start-2 row-start-1 flex w-full flex-col items-center gap-2 text-center"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              toast.success("Link copied");
            }}
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
              <Link2 className="h-6 w-6" />
            </div>
            <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
              Copy link
            </span>
          </button>

          <button
            type="button"
            className="col-start-3 row-start-1 flex w-full flex-col items-center gap-2 text-center"
            onClick={download}
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
            className="col-start-4 row-start-1 flex w-full flex-col items-center gap-2 text-center"
            onClick={async () => {
              // Keep the explicit save action separate (fourth slot) in case users want offline saving.
              if (savedSize) {
                await remove();
              } else {
                await save();
              }
            }}
          >
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
              {savedSize ? (
                <Trash2 className="h-6 w-6" />
              ) : offlineUnlocked ? (
                <Check className="h-6 w-6" />
              ) : (
                <Lock className="h-6 w-6" />
              )}
            </div>
            <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
              {offlineLabel}
            </span>
          </button>

          {/* Row 2: Quality · Auto | Report | (empty or Edit) | (empty or Delete) */}
          {onOpenQuality ? (
            <button
              type="button"
              className="col-start-1 row-start-2 flex w-full flex-col items-center gap-2 text-center"
              onClick={onOpenQuality}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
                <Gauge className="h-6 w-6" />
              </div>
              <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
                Quality{qualityLabel ? ` · ${qualityLabel}` : ""}
              </span>
            </button>
          ) : (
            <div aria-hidden="true" className="col-start-1 row-start-2" />
          )}

          {onReport ? (
            <button
              type="button"
              className="col-start-2 row-start-2 flex w-full flex-col items-center gap-2 text-center"
              onClick={() => {
                onClose();
                onReport();
              }}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
                <Flag className="h-6 w-6" />
              </div>
              <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
                Report
              </span>
            </button>
          ) : (
            <div aria-hidden="true" className="col-start-2 row-start-2" />
          )}

          {isOwner ? (
            <button
              type="button"
              className="col-start-3 row-start-2 flex w-full flex-col items-center gap-2 text-center"
              onClick={() => setEditing(true)}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-white">
                <Pencil className="h-6 w-6" />
              </div>
              <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-white">
                Edit
              </span>
            </button>
          ) : (
            <div aria-hidden="true" className="col-start-3 row-start-2" />
          )}

          {isOwner ? (
            <button
              type="button"
              className="col-start-4 row-start-2 flex w-full flex-col items-center gap-2 text-center"
              onClick={deleteMine}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-red-500 bg-red-600 text-white">
                <Trash2 className="h-6 w-6" />
              </div>
              <span className="w-full truncate whitespace-nowrap text-center text-[11px] font-medium leading-none text-red-400">
                Delete
              </span>
            </button>
          ) : (
            <div aria-hidden="true" className="col-start-4 row-start-2" />
          )}
        </div>

        {progress !== null && (
          <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-white/15">
            <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </aside>

      <OfflinePaywallDialog open={paywallOpen} onClose={() => setPaywallOpen(false)} />

      {/* Stop clicks inside the editor from reaching the sheet's backdrop
          handler, which would unmount the editor mid-edit. */}
      <div onClick={(e) => e.stopPropagation()}>
        <EditVideoDialog
          video={video}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={(next) => {
            onEdited?.(next);
            setEditing(false);
            onClose();
          }}
        />
      </div>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }
  return content;
}
