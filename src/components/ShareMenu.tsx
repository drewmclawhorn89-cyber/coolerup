import { useEffect, useState } from "react";
import { Check, Download, Link2, Share2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type { Video } from "@/lib/loop";
import { formatBytes, getSaved, removeOffline, saveOffline } from "@/lib/offline";

export function ShareMenu({ video, onClose, onShared }: { video: Video; onClose: () => void; onShared: () => void }) {
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const url = typeof window !== "undefined" ? `${window.location.origin}/?v=${video.id}` : "";

  useEffect(() => {
    getSaved(video.id).then((s) => setSavedSize(s ? s.size : null)).catch(() => {});
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

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
    onShared();
  };

  const native = async () => {
    try {
      await navigator.share({ title: `@${video.username} on Loop`, url });
      onShared();
    } catch {
      /* cancelled */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-background/70 backdrop-blur-sm md:items-center" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl border bg-card p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:rounded-3xl md:pb-5"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg">Share</h3>
          <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}><X /></Button>
        </div>
        <div className="flex flex-col gap-2">
          {savedSize !== null ? (
            <div className="flex items-center gap-3 rounded-2xl bg-primary/10 p-4">
              <Check className="h-5 w-5 text-primary" />
              <div className="flex-1">
                <p className="font-bold text-primary">Saved offline</p>
                <p className="text-xs text-muted-foreground">{formatBytes(savedSize)} on this device</p>
              </div>
              <Button variant="ghost" size="icon" aria-label="Remove from offline" onClick={remove}><Trash2 /></Button>
            </div>
          ) : (
            <button onClick={save} disabled={progress !== null} className="relative overflow-hidden rounded-2xl bg-secondary p-4 text-left font-bold transition hover:bg-accent">
              {progress !== null && <span className="absolute inset-y-0 left-0 bg-primary/25" style={{ width: `${progress}%` }} />}
              <span className="relative flex items-center gap-3">
                <Download className="h-5 w-5" />
                {progress !== null ? `Saving… ${progress}%` : "Save for offline"}
              </span>
            </button>
          )}
          <button onClick={copy} className="flex items-center gap-3 rounded-2xl bg-secondary p-4 font-bold transition hover:bg-accent">
            <Link2 className="h-5 w-5" /> Copy link
          </button>
          {typeof navigator !== "undefined" && "share" in navigator && (
            <button onClick={native} className="flex items-center gap-3 rounded-2xl bg-secondary p-4 font-bold transition hover:bg-accent">
              <Share2 className="h-5 w-5" /> Share via…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
