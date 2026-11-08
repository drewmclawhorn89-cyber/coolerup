import { useCallback, useEffect, useState } from "react";

/**
 * One-hour free trial of offline mode.
 *
 * Offline downloads ship with Pro and VIP, so a locked viewer needs a way to
 * try the feature before paying. Every signed-in account gets exactly one hour,
 * once — the clock starts the moment they ask for it and never restarts, even
 * if they sign out and back in.
 *
 * Kept out of the subscription record on purpose: a trial is not a plan, it is
 * a separate grant that simply answers "may this viewer save videos right now?"
 */

/** Length of the trial: one hour, in milliseconds. */
export const TRIAL_MS = 60 * 60 * 1000;

export type Trial = {
  /** when the clock started */
  startedAt: string;
  /** when it runs out — always startedAt + TRIAL_MS */
  endsAt: string;
};

const key = (handle: string) => `trial:${handle}`;
const EVT = "trial-change";

/** The stored trial for this account, or null when they never started one. */
export function getTrial(handle?: string | null): Trial | null {
  if (!handle || typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key(handle));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Trial>;
    if (!parsed?.startedAt || !parsed?.endsAt) return null;
    return { startedAt: parsed.startedAt, endsAt: parsed.endsAt };
  } catch {
    return null;
  }
}

/** Milliseconds left on the trial, floored at zero. */
export function trialRemainingMs(handle?: string | null, now: number = Date.now()): number {
  const trial = getTrial(handle);
  if (!trial) return 0;
  const ends = new Date(trial.endsAt).getTime();
  if (Number.isNaN(ends)) return 0;
  return Math.max(0, ends - now);
}

/** True while the trial is still running. */
export function isTrialActive(handle?: string | null, now: number = Date.now()): boolean {
  return trialRemainingMs(handle, now) > 0;
}

/** True once they have spent their one trial, running or not. */
export function hasUsedTrial(handle?: string | null): boolean {
  return getTrial(handle) !== null;
}

/**
 * Start the clock. Returns the trial that is now in force.
 *
 * Idempotent: calling it again returns the original window instead of handing
 * out a second hour, so a double tap can't extend the trial.
 */
export function startTrial(handle?: string | null): Trial | null {
  if (!handle || typeof window === "undefined") return null;
  const existing = getTrial(handle);
  if (existing) return existing;

  const now = Date.now();
  const trial: Trial = {
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + TRIAL_MS).toISOString(),
  };
  try {
    localStorage.setItem(key(handle), JSON.stringify(trial));
  } catch {
    return null;
  }
  window.dispatchEvent(new Event(EVT));
  return trial;
}

/** `59:59` style countdown. */
export function formatTrialRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Live trial state for one account.
 *
 * Ticks once a second so a countdown can render and so every gate that reads
 * `hasOfflineAccess` re-renders the moment the hour runs out.
 */
export function useTrial(handle?: string | null) {
  const [remainingMs, setRemainingMs] = useState(() => trialRemainingMs(handle));

  useEffect(() => {
    const sync = () => setRemainingMs(trialRemainingMs(handle));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("focus", sync);
    const id = window.setInterval(sync, 1000);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, [handle]);

  const start = useCallback(() => {
    const trial = startTrial(handle);
    setRemainingMs(trialRemainingMs(handle));
    return trial;
  }, [handle]);

  return {
    /** True while the hour is running. */
    active: remainingMs > 0,
    remainingMs,
    /** True once the hour has been spent, running or not. */
    used: hasUsedTrial(handle),
    /** `59:59` for countdowns. */
    label: formatTrialRemaining(remainingMs),
    start,
  };
}
