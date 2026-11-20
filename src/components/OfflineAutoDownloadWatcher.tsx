import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { syncOfflineLibrary } from "@/lib/offlineAutoDownload";
import { OFFLINE_SYNC_EVENT } from "@/lib/offlineEvents";
import { OFFLINE_MODE_EVENT, useOfflineMode } from "@/lib/offlineMode";
import { useOfflineUnlocked } from "@/lib/subscriptions";

/** How often a long-lived session re-checks likes/saves in the background. */
const SYNC_INTERVAL_MS = 5 * 60 * 1000;
/** Coalesce bursts of like/save events into one run. */
const DEBOUNCE_MS = 1500;

/**
 * Keeps the offline library in step with the user's likes and saves while
 * Offline Mode is ON. Mounted once in the root route.
 *
 * Runs only for a paid, active plan. If the plan lapses the watcher simply
 * stops; already-downloaded videos are left alone.
 */
export function OfflineAutoDownloadWatcher() {
  const auth = useAuth();
  const offlineMode = useOfflineMode();
  const paid = useOfflineUnlocked(auth.handle);
  const running = useRef(false);
  const warnedCap = useRef(false);

  useEffect(() => {
    if (!auth.ready || !auth.user || !offlineMode || !paid) return;

    let disposed = false;
    let timer: number | null = null;

    const run = async () => {
      if (disposed || running.current) return;
      if (typeof navigator !== "undefined" && !navigator.onLine) return;
      running.current = true;
      try {
        const result = await syncOfflineLibrary(auth.handle, auth.user?.id);
        if (disposed) return;
        if (result.downloaded > 0) {
          toast.success(
            `Offline Mode: ${result.downloaded} video${result.downloaded === 1 ? "" : "s"} downloaded`,
          );
        }
        if (result.capped && !warnedCap.current) {
          warnedCap.current = true;
          toast.warning("Offline library is full (50 videos). Remove one to download another.");
        }
      } catch {
        // Background sync is best-effort; the manual download buttons still work.
      } finally {
        running.current = false;
      }
    };

    const schedule = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => void run(), DEBOUNCE_MS);
    };

    // Catch up right away, then whenever the app comes back online or the user
    // likes/saves something.
    schedule();
    window.addEventListener("online", schedule);
    window.addEventListener(OFFLINE_SYNC_EVENT, schedule);
    window.addEventListener(OFFLINE_MODE_EVENT, schedule);
    window.addEventListener("focus", schedule);
    const onVisible = () => {
      if (document.visibilityState === "visible") schedule();
    };
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(schedule, SYNC_INTERVAL_MS);

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("online", schedule);
      window.removeEventListener(OFFLINE_SYNC_EVENT, schedule);
      window.removeEventListener(OFFLINE_MODE_EVENT, schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [auth.ready, auth.user, auth.handle, offlineMode, paid]);

  return null;
}
