import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Loader2, Lock, Trash2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { formatBytes, getSavedFullVideo, onOfflineChange, removeFullVideoOffline, saveFullVideoOffline } from "@/lib/offline";
import { hasOfflineAccess, offlinePlan } from "@/lib/subscriptions";
import type { FullVideo } from "@/lib/fullVideos";

/** Save/remove control used on long-form video cards; downloads use the shared offline library. */
export function FullVideoOfflineButton({ video }: { video: FullVideo }) {
  const auth = useAuth();
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const offlineUnlocked = hasOfflineAccess(auth.handle);

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getSavedFullVideo(video.id)
        .then((saved) => { if (alive) setSavedSize(saved?.size ?? null); })
        .catch(() => { if (alive) setSavedSize(null); });
    };
    refresh();
    const off = onOfflineChange(refresh);
    return () => { alive = false; off(); };
  }, [video.id]);

  const toggle = async (event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (progress !== null) return;
    if (savedSize !== null) {
      try {
        await removeFullVideoOffline(video.id);
        setSavedSize(null);
        toast.success("Removed from offline");
      } catch {
        toast.error("Couldn't remove saved video");
      }
      return;
    }
    if (!offlineUnlocked) {
      toast.error(`Save offline is part of Plus ($${offlinePlan().price.toFixed(2)}/mo)`);
      window.location.href = "/?tab=subscriptions";
      return;
    }
    setProgress(0);
    try {
      const size = await saveFullVideoOffline(video, setProgress);
      setSavedSize(size);
      toast.success("Saved for offline viewing");
    } catch (error) {
      console.error(error);
      toast.error("Couldn't save this video. Check your connection.");
    } finally {
      setProgress(null);
    }
  };

  const label = progress !== null
    ? `Saving ${progress}%`
    : savedSize !== null
      ? `Remove offline · ${formatBytes(savedSize)}`
      : offlineUnlocked
        ? "Save offline"
        : "Save offline · Plus";

  return (
    <button
      type="button"
      onClick={(event) => void toggle(event)}
      disabled={progress !== null}
      aria-label={label}
      title={label}
      className="absolute left-1.5 top-1.5 z-10 flex min-h-8 max-w-[calc(100%-5rem)] items-center gap-1.5 rounded-full bg-black/75 px-2.5 text-[11px] font-medium text-white shadow-sm backdrop-blur transition hover:bg-black/90 disabled:opacity-80"
    >
      {progress !== null ? <Loader2 className="size-3.5 animate-spin" /> : savedSize !== null ? <Trash2 className="size-3.5" /> : offlineUnlocked ? <Download className="size-3.5" /> : <Lock className="size-3.5" />}
      <span className="truncate">{label}</span>
    </button>
  );
}
