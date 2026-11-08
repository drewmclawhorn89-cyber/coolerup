import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  getSavedFullVideo,
  onOfflineChange,
  removeFullVideoOffline,
  saveFullVideoOffline,
} from "@/lib/offline";
import { hasOfflineAccess, offlinePlan } from "@/lib/subscriptions";
import type { FullVideo } from "@/lib/fullVideos";

/**
 * Shared offline state for one long-form video.
 *
 * Every surface that offers "download for offline" (the card badge, the share
 * sheet, the watch-page action row) goes through this hook so the saved size,
 * in-flight progress and the Plus gate all behave identically.
 */
export function useFullVideoOffline(video: Pick<FullVideo, "id"> & Partial<FullVideo>) {
  const auth = useAuth();
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const offlineUnlocked = hasOfflineAccess(auth.handle);
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
    if (busy || progress !== null) return false;
    setBusy(true);
    try {
      // Removing a saved copy is always allowed, even if the plan lapsed.
      if (savedSize !== null) {
        await removeFullVideoOffline(video.id);
        setSavedSize(null);
        toast.success("Removed from offline");
        return true;
      }

      if (!offlineUnlocked) {
        toast.error(`Offline mode is part of Plus ($${offlinePlan().price.toFixed(2)}/mo)`);
        window.location.href = "/?tab=subscriptions";
        return false;
      }

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
  }, [busy, progress, savedSize, offlineUnlocked, video]);

  return { savedSize, progress, busy, isSaved, offlineUnlocked, toggle };
}
