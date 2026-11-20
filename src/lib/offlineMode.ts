import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * The Offline Mode preference.
 *
 * Offline Mode is a paid feature: the toggle is only honoured for a live,
 * paid plan (see `planUnlocksOffline` in `@/lib/subscriptions`). The
 * preference itself is a device setting in localStorage so it survives a
 * reload, but every read is paired with a paid check at the call site.
 */

export const OFFLINE_MODE_KEY = "settings:offline";
export const OFFLINE_MODE_EVENT = "coolerup-offline-mode";

function read(): boolean {
  try {
    return localStorage.getItem(OFFLINE_MODE_KEY) === "true";
  } catch {
    return false;
  }
}

export function isOfflineModeOn(): boolean {
  return read();
}

/** Persist the preference and notify every mounted screen. */
export function setOfflineModeOn(on: boolean): void {
  try {
    localStorage.setItem(OFFLINE_MODE_KEY, String(on));
  } catch {
    // Storage can be disabled (private mode); the in-memory event still runs.
  }
  window.dispatchEvent(new Event(OFFLINE_MODE_EVENT));
}

function subscribe(listener: () => void) {
  window.addEventListener(OFFLINE_MODE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(OFFLINE_MODE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

/** Reactive Offline Mode flag for components. */
export function useOfflineMode(): boolean {
  return useSyncExternalStore(subscribe, read, () => false);
}

/** Reactive `navigator.onLine` flag, so the Videos tab can appear offline. */
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    // Re-read on mount in case the state changed before hydration.
    setOnline(navigator.onLine);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  return online;
}
