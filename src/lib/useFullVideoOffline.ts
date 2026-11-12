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
import { useTrial } from "@/lib/trial";
import type { FullVideo } from "@/lib/fullVideos";

/**
 * Shared offline state for one long-form video.
 *
 * Every surface that offers "download for offline" (the card badge, the share
 * sheet, the watch-page action row) goes through this hook so the saved size,
 * in-flight progress and the Pro/VIP gate all behave identically.
 */
export function useFullVideoOffline(video: Pick<FullVideo, "id"> & Partial<FullVideo>) {
  const auth = useAuth();
  const [savedSize, setSavedSize] = useState<number | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  // Offline mode ships with Pro and VIP, with one free hour to try it.
  const trial = useTrial(auth.handle, offlinePlan().id);
  // Pull the stable pieces out so `toggle` doesn't depend on the whole object.
  const { used: trialUsed, start: startTrial } = trial;
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
    if (video.is_youtube) {
      toast.error("YouTube videos are available online only.");
      return false;
    }
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
        // A first-time viewer gets the hour instead of a paywall; once it is
        // spent, saving is a paid feature again.
        if (trialUsed) {
          const plan = offlinePlan();
          toast.error(
            `Your free trial has ended. Offline mode is part of ${plan.label} ($${plan.price.toFixed(2)}/mo)`,
          );
          window.location.href = "/?tab=subscriptions";
          return false;
        }
        startTrial();
        toast.success("1-hour free trial started");
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
  }, [busy, progress, savedSize, offlineUnlocked, trialUsed, startTrial, video]);

  return {
    savedSize,
    progress,
    busy,
    isSaved,
    offlineUnlocked,
    /** True while the one-hour free trial is running. */
    trialActive: trial.active,
    /** True once the hour has been spent, running or not. */
    trialUsed: trial.used,
    /** `59:59` countdown for the trial. */
    trialLabel: trial.label,
    toggle,
  };
}
