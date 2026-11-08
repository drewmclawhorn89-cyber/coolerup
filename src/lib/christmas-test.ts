/**
 * Owner-only "test the Christmas Update" switch.
 *
 * The real Christmas Update turns itself on with a plain date check (see
 * `@/lib/christmas` and `@/lib/christmas-codes`). That's great for shipping, but
 * it means there is no way to look at the update in July. This module adds a
 * local, per-device override that only the owner can reach from Settings.
 *
 * The flag lives in `localStorage` under `christmas-test-override`, so it never
 * touches the database, never affects other users, and disappears when the
 * owner clears their site data. Both Christmas gates OR this flag into their
 * date check, and both hooks listen for the `christmas-test-change` event so the
 * whole app flips instantly when the switch is toggled.
 *
 * Keep this file free of React APIs at module scope so it can be imported from
 * anywhere. The hook lives at the bottom.
 */
import { useEffect, useState } from "react";

/** The only account allowed to see the test switch. */
export const CHRISTMAS_TEST_OWNER = "drewmclawhorn3";

/** localStorage key holding the override. */
export const CHRISTMAS_TEST_KEY = "christmas-test-override";

/** Fired on `window` whenever the override changes, so hooks can re-read it. */
export const CHRISTMAS_TEST_EVENT = "christmas-test-change";

/** True when the current handle is the owner allowed to run the test mode. */
export function isChristmasTestOwner(handle: string | null | undefined): boolean {
  return (handle ?? "").replace(/^@/, "").toLowerCase() === CHRISTMAS_TEST_OWNER;
}

/** True when the owner has forced the Christmas Update on for this device. */
export function isChristmasTestMode(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(CHRISTMAS_TEST_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Turn the override on or off. Safe to call during render handlers; it updates
 * storage and then notifies every mounted Christmas hook on this tab.
 */
export function setChristmasTestMode(on: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (on) window.localStorage.setItem(CHRISTMAS_TEST_KEY, "1");
    else window.localStorage.removeItem(CHRISTMAS_TEST_KEY);
  } catch {
    /* storage can be blocked in private mode; the event still fires */
  }
  window.dispatchEvent(new Event(CHRISTMAS_TEST_EVENT));
}

/**
 * React binding for `isChristmasTestMode()`.
 *
 * Re-reads when the switch is toggled in this tab, when another tab writes the
 * key, and when the page becomes visible again.
 */
export function useChristmasTestMode(): boolean {
  const [on, setOn] = useState<boolean>(() => isChristmasTestMode());

  useEffect(() => {
    const refresh = () => setOn(isChristmasTestMode());
    refresh();

    window.addEventListener(CHRISTMAS_TEST_EVENT, refresh);
    window.addEventListener("storage", refresh);
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.removeEventListener(CHRISTMAS_TEST_EVENT, refresh);
      window.removeEventListener("storage", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  return on;
}
