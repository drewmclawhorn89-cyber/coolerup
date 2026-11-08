import { useCallback, useEffect, useState } from "react";

import { PLANS } from "@/lib/plans";

/**
 * One-hour free trial, on every plan.
 *
 * Each subscription plan (Plus, Pro and VIP) comes with its own free hour, so a
 * viewer can try a tier before paying for it. The clock starts the moment they
 * ask for it and never restarts: once a plan's hour is spent it is spent, even
 * if they sign out and back in. Trying a different plan starts that plan's own
 * hour, which is why the record is keyed per plan.
 *
 * Kept out of the subscription record on purpose: a trial is not a plan, it is
 * a separate grant that answers "which plan's perks are live right now?".
 */

/** Length of every trial: one hour, in milliseconds. */
export const TRIAL_MS = 60 * 60 * 1000;

/**
 * Plan that the very first version of the trial belonged to. That version only
 * unlocked offline downloads, so a leftover record migrates onto the cheapest
 * offline plan rather than being thrown away.
 */
const LEGACY_PLAN_ID = "pro";

export type Trial = {
  /** the plan whose perks this hour unlocks */
  planId: string;
  /** when the clock started */
  startedAt: string;
  /** when it runs out — always startedAt + TRIAL_MS */
  endsAt: string;
};

const key = (handle: string, planId: string) => `trial:${handle}:${planId}`;
const legacyKey = (handle: string) => `trial:${handle}`;
const EVT = "trial-change";

/** Parse a stored record, filling in the plan id when an old record lacks one. */
function parse(raw: string | null, fallbackPlanId?: string): Trial | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<Trial>;
    if (!parsed?.startedAt || !parsed?.endsAt) return null;
    const planId =
      typeof parsed.planId === "string" && parsed.planId ? parsed.planId : fallbackPlanId;
    if (!planId) return null;
    return { planId, startedAt: parsed.startedAt, endsAt: parsed.endsAt };
  } catch {
    return null;
  }
}

/** The stored trial for this account and plan, or null when there isn't one. */
export function getTrial(handle?: string | null, planId?: string | null): Trial | null {
  if (!handle || !planId || typeof window === "undefined") return null;
  const own = parse(localStorage.getItem(key(handle, planId)), planId);
  if (own) return own;
  // One-time migration: the first trial had no plan attached and unlocked
  // offline mode, so it belongs to the legacy offline plan.
  if (planId === LEGACY_PLAN_ID) {
    return parse(localStorage.getItem(legacyKey(handle)), LEGACY_PLAN_ID);
  }
  return null;
}

/** The trial that is running right now, if any plan's hour is still live. */
export function activeTrial(handle?: string | null, now: number = Date.now()): Trial | null {
  let best: Trial | null = null;
  for (const plan of PLANS) {
    const trial = getTrial(handle, plan.id);
    if (!trial) continue;
    const ends = new Date(trial.endsAt).getTime();
    if (Number.isNaN(ends) || ends <= now) continue;
    if (!best || ends > new Date(best.endsAt).getTime()) best = trial;
  }
  return best;
}

/**
 * Milliseconds left on a trial, floored at zero.
 *
 * Pass a plan id to measure that plan's hour; leave it out to measure whichever
 * hour is currently running.
 */
export function trialRemainingMs(
  handle?: string | null,
  planId?: string | null,
  now: number = Date.now(),
): number {
  const trial = planId ? getTrial(handle, planId) : activeTrial(handle, now);
  if (!trial) return 0;
  const ends = new Date(trial.endsAt).getTime();
  if (Number.isNaN(ends)) return 0;
  return Math.max(0, ends - now);
}

/** True while the trial is still running. */
export function isTrialActive(
  handle?: string | null,
  planId?: string | null,
  now: number = Date.now(),
): boolean {
  return trialRemainingMs(handle, planId, now) > 0;
}

/**
 * True once they have spent a trial, running or not.
 *
 * Pass a plan id to ask about that plan's hour; leave it out to ask whether any
 * plan's hour has been spent.
 */
export function hasUsedTrial(handle?: string | null, planId?: string | null): boolean {
  if (!handle) return false;
  if (planId) return getTrial(handle, planId) !== null;
  return PLANS.some((plan) => getTrial(handle, plan.id) !== null);
}

/**
 * Start the clock for one plan. Returns the trial that is now in force.
 *
 * Idempotent per plan: calling it again returns the original window instead of
 * handing out a second hour, so a double tap can't extend the trial.
 */
export function startTrial(handle?: string | null, planId?: string | null): Trial | null {
  if (!handle || !planId || typeof window === "undefined") return null;
  const existing = getTrial(handle, planId);
  if (existing) return existing;

  const now = Date.now();
  const trial: Trial = {
    planId,
    startedAt: new Date(now).toISOString(),
    endsAt: new Date(now + TRIAL_MS).toISOString(),
  };
  try {
    localStorage.setItem(key(handle, planId), JSON.stringify(trial));
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
 * Pass a plan id to follow that plan's hour (and have `start()` begin it).
 * Leave it out to follow whichever hour is currently running.
 *
 * Ticks once a second so a countdown can render and so every gate that reads
 * `hasOfflineAccess` re-renders the moment the hour runs out.
 */
export function useTrial(handle?: string | null, planId?: string | null) {
  const [remainingMs, setRemainingMs] = useState(() => trialRemainingMs(handle, planId));
  const [trial, setTrial] = useState(() =>
    planId ? getTrial(handle, planId) : activeTrial(handle),
  );

  useEffect(() => {
    const sync = () => {
      setRemainingMs(trialRemainingMs(handle, planId));
      setTrial(planId ? getTrial(handle, planId) : activeTrial(handle));
    };
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("focus", sync);
    const id = window.setInterval(sync, 1000);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("focus", sync);
      window.clearInterval(id);
    };
  }, [handle, planId]);

  const start = useCallback(
    (id?: string) => {
      const target = id ?? planId;
      if (!target) return null;
      const started = startTrial(handle, target);
      setRemainingMs(trialRemainingMs(handle, target));
      setTrial(getTrial(handle, target));
      return started;
    },
    [handle, planId],
  );

  return {
    /** True while the hour is running. */
    active: remainingMs > 0,
    remainingMs,
    /** True once the hour has been spent, running or not. */
    used: planId ? hasUsedTrial(handle, planId) : hasUsedTrial(handle),
    /** `59:59` for countdowns. */
    label: formatTrialRemaining(remainingMs),
    /** Plan the tracked hour belongs to, if any. */
    planId: trial?.planId ?? planId ?? null,
    start,
  };
}
