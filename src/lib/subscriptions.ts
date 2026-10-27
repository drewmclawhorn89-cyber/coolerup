import { useEffect, useState } from "react";

export type Plan = {
  id: string;
  label: string;
  emoji: string;
  /** price in USD per month */
  price: number;
  perks: string[];
};

/** Every plan gets the same 7 day free trial. */
export const TRIAL_DAYS = 7;

export const PLANS: Plan[] = [
  {
    id: "plus",
    label: "Plus",
    emoji: "⭐",
    price: 4.99,
    perks: ["Ad-free feed", "Plus badge on your profile"],
  },
  {
    id: "pro",
    label: "Pro",
    emoji: "🚀",
    price: 9.99,
    perks: ["Everything in Plus", "Exclusive tops and names", "Priority uploads"],
  },
  {
    id: "vip",
    label: "VIP",
    emoji: "👑",
    price: 19.99,
    perks: ["Everything in Pro", "VIP badge", "Early access to new features"],
  },
];

export const VENMO_HANDLE = "Samantha-Barnes-168";

export function venmoUrl(plan: Plan, handle?: string | null) {
  const note = encodeURIComponent(
    `Coolerup ${plan.label} subscription${handle ? ` (@${handle})` : ""}`,
  );
  return `https://venmo.com/${VENMO_HANDLE}?txn=pay&amount=${plan.price.toFixed(2)}&note=${note}`;
}

/* -------------------------------------------------------------------------- */
/*  Subscription record                                                       */
/* -------------------------------------------------------------------------- */

export type SubStatus = "trial" | "pending" | "active" | "expired";

export type Subscription = {
  planId: string;
  status: SubStatus;
  /** when the trial began */
  startedAt: string;
  /** when the free trial runs out */
  trialEndsAt: string;
  /** set once the owner confirms the Venmo payment */
  paidAt: string | null;
};

const key = (handle: string) => `subscription:${handle}`;
const usedKey = (handle: string) => `trial-used:${handle}`;
const EVT = "subscription-change";

const DAY_MS = 24 * 60 * 60 * 1000;

export function planById(id?: string | null): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/**
 * Old versions stored a bare string ("pro" or "pending:pro"). Turn anything we
 * find into the current shape so existing users don't lose their plan.
 */
function migrate(raw: string): Subscription | null {
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      return JSON.parse(raw) as Subscription;
    } catch {
      return null;
    }
  }
  const now = new Date();
  if (raw.startsWith("pending:")) {
    return {
      planId: raw.slice(8),
      status: "pending",
      startedAt: now.toISOString(),
      trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
      paidAt: null,
    };
  }
  // Legacy "active" plan with no dates — treat as active, no trial left.
  return {
    planId: raw,
    status: "active",
    startedAt: now.toISOString(),
    trialEndsAt: now.toISOString(),
    paidAt: now.toISOString(),
  };
}

/** Trial is over but they never paid -> "expired". */
function withCurrentStatus(sub: Subscription): Subscription {
  if (sub.status !== "trial") return sub;
  if (Date.now() >= new Date(sub.trialEndsAt).getTime()) {
    return { ...sub, status: "expired" };
  }
  return sub;
}

export function getSubscription(handle?: string | null): Subscription | null {
  if (!handle || typeof window === "undefined") return null;
  const raw = localStorage.getItem(key(handle));
  if (!raw) return null;
  const sub = migrate(raw);
  return sub ? withCurrentStatus(sub) : null;
}

/** Whole days left in the trial, rounded up. 0 once it has expired. */
export function trialDaysLeft(sub: Subscription | null): number {
  if (!sub || sub.status !== "trial") return 0;
  const ms = new Date(sub.trialEndsAt).getTime() - Date.now();
  return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS);
}

/** One free trial per account, ever. */
export function hasUsedTrial(handle?: string | null): boolean {
  if (!handle || typeof window === "undefined") return false;
  return localStorage.getItem(usedKey(handle)) === "1";
}

export function canStartTrial(handle?: string | null): boolean {
  if (!handle) return false;
  const sub = getSubscription(handle);
  if (sub && (sub.status === "trial" || sub.status === "active" || sub.status === "pending"))
    return false;
  return !hasUsedTrial(handle);
}

function write(handle: string, sub: Subscription | null) {
  if (sub) localStorage.setItem(key(handle), JSON.stringify(sub));
  else localStorage.removeItem(key(handle));
  window.dispatchEvent(new Event(EVT));
}

/** Start the 7 day free trial. No payment is taken up front. */
export function startTrial(handle: string, planId: string): Subscription {
  const now = new Date();
  const sub: Subscription = {
    planId,
    status: "trial",
    startedAt: now.toISOString(),
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
    paidAt: null,
  };
  localStorage.setItem(usedKey(handle), "1");
  write(handle, sub);
  return sub;
}

/**
 * Payments go through Venmo, which does not report back to the app, so the plan
 * sits at "pending" until the owner confirms the payment and flips it to
 * "active" with `confirmPayment`.
 */
export function requestPayment(handle: string, planId: string) {
  const existing = getSubscription(handle);
  const now = new Date();
  write(handle, {
    planId,
    status: "pending",
    startedAt: existing?.startedAt ?? now.toISOString(),
    trialEndsAt:
      existing?.trialEndsAt ?? new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
    paidAt: null,
  });
}

/** Owner confirms the Venmo payment landed. */
export function confirmPayment(handle: string) {
  const existing = getSubscription(handle);
  if (!existing) return;
  write(handle, { ...existing, status: "active", paidAt: new Date().toISOString() });
}

export function cancelSubscription(handle: string) {
  write(handle, null);
}

/** True when the plan is giving them perks right now. */
export function isActive(sub: Subscription | null): boolean {
  return sub?.status === "trial" || sub?.status === "active";
}

export function useSubscription(handle?: string | null) {
  const [sub, setSub] = useState<Subscription | null>(null);
  useEffect(() => {
    const sync = () => setSub(getSubscription(handle));
    sync();
    window.addEventListener(EVT, sync);
    // Re-check on focus so a trial that lapses mid-session flips to expired.
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [handle]);
  return sub;
}
