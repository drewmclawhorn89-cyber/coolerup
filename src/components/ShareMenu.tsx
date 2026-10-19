import { useEffect, useState } from "react";
import { Check, Download, Link2, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Video } from "@/lib/loop";
import { formatBytes, getSaved, removeOffline, saveOffline } from "@/lib/offline";
import { useAuth } from "@/hooks/useAuth"
import { supabase } from "@/lib/supabase"
import { Trash2 } from "lucide-react"

function DeleteMyVideoButton({ video, onDeleted }: { video: any, onDeleted: () => void }) {
  const { user } = useAuth()

  // ONLY show if you posted it
  if (!user || video.user_id !== user.id) return null

  const handleDelete = async () => {
    const confirm = window.confirm("Delete this video? This can't be undone.")
    if (!confirm) return

    // 1. Delete from database - RLS makes sure only you can delete your own
    const { error } = await supabase
      .from("videos")
      .delete()
      .eq("id", video.id)
      .eq("user_id", user.id) // extra safety

    if (error) {
      alert("Failed to delete: " + error.message)
      return
    }

    // 2. Delete file from storage if you have it
    if (video.video_url) {
      const fileName = video.video_url.split("/").pop()
      await supabase.storage.from("videos").remove([fileName])
    }

    alert("Video deleted")
    onDeleted() // close sheet + refresh feed
  }

  return (
    <button 
      onClick={handleDelete}
      className="flex flex-col items-center gap-1 text-red-500"
    >
      <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
        <Trash2 className="w-6 h-6" />
      </div>
      <span className="text-xs">Delete</span>
    </button>
  )
}
export function ShareMenu({ video, onClose, onShared }: { video: Video; onClose: () => void; onShared: () => void }) {
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const url = typeof window!== "undefined"? `${window.location.origin}/v/${video.id}` : "";

  useEffect(() => {
    getSaved(video.id).then((s) => setSavedSize(s?.size?? null)).catch(() => {});
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

  const download = async () => {
    try {
      // Try a direct fetch of the video URL and trigger a client-side download.
      const resp = await fetch(video.video_url);
      if (!resp.ok) throw new Error("Network response was not ok");
      const blob = await resp.blob();
      const extMatch = (video.video_url || "").match(/\.([a-z0-9]+)(?:[?#]|$)/i);
      const ext = extMatch ? extMatch[1] : "mp4";
      const filename = `${video.id}.${ext}`;
      const href = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(href);
      toast.success("Download started");
      onShared();
    } catch (err) {
      console.error(err);
      toast.error("Couldn't download the file. The host may block cross-origin requests.");
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
            onClick={() => (savedSize ? remove() : download())}
          >
            <div className="w-14 h-14 rounded-full bg-zinc-800 flex items-center justify-center">
              {savedSize ? <Check size={22} /> : <Download size={22} />}
            </div>
            <span className="text-xs text-zinc-300">
              {savedSize ? formatBytes(savedSize) : "Download"}
            </span>
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
              {savedSize ? <Trash2 size={22} /> : <Check size={22} />}
            </div>
            <span className="text-xs text-zinc-300">{savedSize ? "Remove" : "Save"}</span>
          </button>
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
