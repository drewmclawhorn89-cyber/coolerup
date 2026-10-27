import { useEffect, useState } from "react";
import { Check, Download, Link2, Lock, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { deleteVideo, resolveVideoUrl, type Video } from "@/lib/loop";
import { formatBytes, getSaved, removeOffline, saveOffline } from "@/lib/offline";
import { hasOfflineAccess, offlinePlan } from "@/lib/subscriptions";

export function ShareMenu({ video, onClose, onShared, onDeleted }: { video: Video; onClose: () => void; onShared: () => void; onDeleted?: () => void }) {
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const auth = useAuth();
  const isOwner = !!auth.user && !!auth.handle && auth.handle === video.username;
  const url = typeof window!== "undefined"? `${window.location.origin}/v/${video.id}` : "";

  useEffect(() => {
    getSaved(video.id).then((s) => setSavedSize(s?.size?? null)).catch(() => {});
  }, [video.id]);

  const offlineUnlocked = hasOfflineAccess(auth.handle);

  const save = async () => {
    // Offline downloads are a paid perk. Removing is always allowed.
    if (!offlineUnlocked) {
      toast.error(`Save offline is part of Plus ($${offlinePlan().price.toFixed(2)}/mo)`);
      onClose();
      window.location.href = "/?tab=subscriptions";
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
      const extMatch = (video.video_url || "").match(/\.([a-z0-9]{2,4})(?:[?#]|$)/i);
      const ext = extMatch?.[1] ?? (blob.type.includes("webm") ? "webm" : blob.type.startsWith("image/") ? blob.type.split("/")[1] : "mp4");
      const filename = `${video.id}.${ext}`;
      const type = blob.type || `video/${ext}`;
      const file = new File([blob], filename, { type });

      // On phones, the share sheet is the way to save to the camera roll / Files.
      const isTouch = typeof navigator !== "undefined" && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isTouch && navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file] });
          toast.success("Saved", { id: t });
          onShared();
          return;
        } catch (e: any) {
          if (e?.name === "AbortError") {
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
      onShared();
    } catch (err) {
      console.error(err);
      toast.error("Couldn't download this video. Try again.", { id: t });
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end justify-center p-0" onClick={onClose}>
      <div className="bg-zinc-900 w-full max-w-md rounded-t- p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-bold text-lg text-white">Share</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-zinc-800 flex items-center justify-center">
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
                } catch {}
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
            onClick={download}
          >
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              <Download size={22} />
            </div>
            <span className="text-xs text-zinc-300">Download</span>
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
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              {savedSize ? (
                <Trash2 size={22} />
              ) : offlineUnlocked ? (
                <Check size={22} />
              ) : (
                <Lock size={22} className="text-zinc-400" />
              )}
            </div>
            <span className="text-xs text-zinc-300">
              {savedSize ? `Remove (${formatBytes(savedSize)})` : offlineUnlocked ? "Save offline" : "Plus only"}
            </span>
          </button>

          {isOwner && (
            <button className="flex flex-col items-center gap-2" onClick={deleteMine}>
              <div className="w-14 h-14 rounded-full bg-red-600 flex items-center justify-center">
                <Trash2 size={22} />
              </div>
              <span className="text-xs text-red-400">Delete</span>
            </button>
          )}
        </div>

        {progress!== null && (
          <div className="w-full bg-zinc-800 h-2 rounded-full overflow-hidden">
            <div className="h-full bg-white transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}

        <div className="text-xs text-zinc-500 text-center pt-2">{url}</div>
      </div>
    </div>
  );
}
