import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  getSavedFullVideo,
  onOfflineChange,
  removeFullVideoOffline,
  saveFullVideoOffline,
} from "@/lib/offline";
import { planUnlocksOffline } from "@/lib/subscriptions";
import type { FullVideo } from "@/lib/fullVideos";

/**
 * Shared offline state for one long-form video.
 *
 * Every surface that offers "download for offline" (the card badge, the share
 * sheet, the watch-page action row) goes through this hook so the saved size,
 * in-flight progress and the paid-subscriber gate all behave identically.
 *
 * Offline mode is a paid feature. When the viewer has no active paid plan the
 * hook never downloads anything: `toggle()` flips `paywallOpen` so the caller
 * can show the "Offline Mode is for Paid Subscribers" dialog.
 */
export function useFullVideoOffline(video: Pick<FullVideo, "id"> & Partial<FullVideo>) {
  const auth = useAuth();
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [paywallOpen, setPaywallOpen] = useState(false);

  const offlineUnlocked = planUnlocksOffline(auth.handle);
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

  const closePaywall = useCallback(() => setPaywallOpen(false), []);

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

    // Paid subscribers only — nothing is downloaded for anyone else.
    if (!offlineUnlocked) {
      setPaywallOpen(true);
      return false;
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
  }, [busy, progress, savedSize, offlineUnlocked, video]);

  return {
    savedSize,
    progress,
    busy,
    isSaved,
    /** True only when the viewer has an active paid plan. */
    offlineUnlocked,
    /** True when the paid-subscriber dialog should be shown. */
    paywallOpen,
    closePaywall,
    toggle,
  };
}
