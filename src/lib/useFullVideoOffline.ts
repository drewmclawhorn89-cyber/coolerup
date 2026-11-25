import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getSavedFullVideo,
  onOfflineChange,
  removeFullVideoOffline,
  saveFullVideoOffline,
} from "@/lib/offline";
import type { FullVideo } from "@/lib/fullVideos";

/** Shared download state for a long-form video. */
export function useFullVideoOffline(video: Pick<FullVideo, "id"> & Partial<FullVideo>) {
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const isSaved = savedSize !== null;

  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void getSavedFullVideo(video.id)
        .then((saved) => {
          if (alive) setSavedSize(saved?.size ?? null);
        })
        .catch(() => {
          if (alive) setSavedSize(null);
        });
    };
    refresh();
    const off = onOfflineChange(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [video.id]);

  /** Save when not saved, remove when saved. Returns true when state changed. */
  const toggle = useCallback(async (): Promise<boolean> => {
    if (video.is_youtube) {
      toast.error("YouTube videos are available online only.");
      return false;
    }
    if (busy || progress !== null) return false;

    // Removing a saved copy is always allowed, even if the plan lapsed.
    if (savedSize !== null) {
      setBusy(true);
      try {
        await removeFullVideoOffline(video.id);
        setSavedSize(null);
        toast.success("Removed from offline");
        return true;
      } catch (error) {
        console.error(error);
        toast.error("Couldn't remove this video.");
        return false;
      } finally {
        setBusy(false);
      }
    }

    setBusy(true);
    try {
      setProgress(0);
      const size = await saveFullVideoOffline(video as FullVideo, setProgress);
      setSavedSize(size);
      toast.success("Saved for offline viewing");
      return true;
    } catch (error) {
      console.error(error);
      toast.error("Couldn't save this video. Check your connection.");
      return false;
    } finally {
      setProgress(null);
      setBusy(false);
    }
  }, [busy, progress, savedSize, video]);

  return {
    savedSize,
    progress,
    busy,
    isSaved,
    toggle,
  };
}
