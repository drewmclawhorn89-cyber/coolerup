import { useEffect, useState } from "react";
import { Check, Download, Flag, Gauge, Link2, Pencil, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { deleteVideo, resolveVideoUrl, type Video } from "@/lib/loop";
import { formatBytes, getSaved, removeOffline, saveOffline } from "@/lib/offline";
import { EditVideoDialog } from "@/components/EditVideoDialog";
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
  const [editing, setEditing] = useState(false);
  const isOwner = !!auth.user && !!auth.handle && auth.handle === video.username;
  const url = typeof window !== "undefined" ? `${window.location.origin}/v/${video.id}` : "";

  useEffect(() => {
    getSaved(video.id)
      .then((s) => setSavedSize(s?.size ?? null))
      .catch(() => {});
  }, [video.id]);

  const save = async () => {
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

  const [readyFile, setReadyFile] = useState<File | null>(null);
  const download = async () => {
    // iOS requires a fresh tap after the asynchronous watermark encoding.
    if (readyFile) {
      try {
        await navigator.share({ files: [readyFile] });
        setReadyFile(null);
        onShared?.();
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError"))
          toast.error("Couldn’t open the share sheet. Tap Save to try again.");
      }
      return;
    }
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

      if (navigator.canShare?.({ files: [file] })) {
        setReadyFile(file);
        toast.success("Ready. Tap Save to open the share sheet.", { id: t });
        return;
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

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end justify-center p-0"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 w-full max-w-md rounded-t- p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-white">Share</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center"
          >
            <X size={18} />
          </button>
        </div>

        <div className="grid grid-cols-4 gap-4 pt-2">
          <button
            className="flex flex-col items-center gap-2"
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
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              <Share2 size={22} />
            </div>
            <span className="text-xs text-zinc-300">Share</span>
          </button>

          {/* EDIT — owner-only. Opens the trim/caption editor for this Short. */}
          {isOwner && (
            <button className="flex flex-col items-center gap-2" onClick={() => setEditing(true)}>
              <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
                <Pencil size={22} />
              </div>
              <span className="text-xs text-zinc-300">Edit</span>
            </button>
          )}

          <button
            className="flex flex-col items-center gap-2"
            onClick={async () => {
              await navigator.clipboard.writeText(url);
              toast.success("Link copied");
            }}
          >
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              <Link2 size={22} />
            </div>
            <span className="text-xs text-zinc-300">Copy link</span>
          </button>

          <button
            className="flex flex-col items-center gap-2"
            aria-label={readyFile ? "Save to Photos or share" : "Download"}
            onClick={download}
          >
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              <Download size={22} />
            </div>
            <span className="text-xs text-zinc-300">{readyFile ? "Save…" : "Download"}</span>
          </button>

          <button
            className="flex flex-col items-center gap-2"
            onClick={async () => {
              // Keep the explicit save action separate (fourth slot) in case users want offline saving.
              if (savedSize) {
                await remove();
              } else {
                await save();
              }
            }}
          >
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center ${"bg-zinc-800"}`}
            >
              {savedSize ? <Trash2 size={22} /> : <Check size={22} />}
            </div>
            <span className="text-xs text-zinc-300">
              {savedSize ? `Remove (${formatBytes(savedSize)})` : "Save offline"}
            </span>
          </button>

          {onOpenQuality && (
            <button className="flex flex-col items-center gap-2" onClick={onOpenQuality}>
              <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
                <Gauge size={22} />
              </div>
              <span className="text-xs text-zinc-300">
                Quality{qualityLabel ? ` · ${qualityLabel}` : ""}
              </span>
            </button>
          )}

          {isOwner && (
            <button className="flex flex-col items-center gap-2" onClick={deleteMine}>
              <div className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center">
                <Trash2 size={22} />
              </div>
              <span className="text-xs text-red-400">Delete</span>
            </button>
          )}

          {/* REPORT — moved off the video rail and into the share sheet */}
          {onReport && (
            <button
              className="flex flex-col items-center gap-2"
              onClick={() => {
                onClose();
                onReport();
              }}
            >
              <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
                <Flag size={22} />
              </div>
              <span className="text-xs text-zinc-300">Report</span>
            </button>
          )}
        </div>

        {progress !== null && (
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
            <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="text-xs text-zinc-500 text-center pt-2">{url}</div>
      </div>

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
}
