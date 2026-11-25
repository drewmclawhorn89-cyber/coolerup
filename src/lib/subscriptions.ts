import { useEffect, useState } from "react";

import {
  PLANS,
  planById,
  planIncludesBackgroundPlay,
  planIncludesMusicOffline,
  planIncludesOffline,
  backgroundPlayPlan,
  musicOfflinePlan,
  offlinePlan,
  type Plan,
} from "@/lib/plans";
import { activeTrial, hasUsedTrial, isTrialActive } from "@/lib/trial";
import {
  ACCOUNT_SUBSCRIPTION_EVENT,
  cancelAccountSubscriptionForHandle,
  cachedAccountSubscription,
  clearCachedAccountSubscription,
  persistAccountSubscriptionForHandle,
  refreshAccountSubscription,
  setCachedAccountSubscription,
  type AccountSubscriptionInput,
  type AccountSubscriptionRow,
} from "@/lib/accountSubscriptions";
import {
  LIFETIME_EVENT,
  cachedLifetime,
  isLifetimeActive,
  isLifetimeRevoked,
  refreshLifetime,
} from "@/lib/subscription";

export type { Plan };
export {
  PLANS,
  planById,
  planIncludesBackgroundPlay,
  planIncludesMusicOffline,
  planIncludesOffline,
  backgroundPlayPlan,
  musicOfflinePlan,
  offlinePlan,
};

export const VENMO_HANDLE = "Drew-McLawhorn-2";

export function venmoUrl(plan: Plan, handle?: string | null) {
  const note = encodeURIComponent(
    `Coolerup ${plan.label} subscription${handle ? ` (@${handle})` : ""}`,
  );
  return `https://venmo.com/${VENMO_HANDLE}?txn=pay&amount=${plan.price.toFixed(2)}&note=${note}`;
}

/* -------------------------------------------------------------------------- */
/*  Payment method                                                            */
/* -------------------------------------------------------------------------- */

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "card";

/** Where the payment method came from. */
export type PaymentProvider = "card" | "googlepay" | "venmo";

export type PaymentMethod = {
  brand: CardBrand;
  /** last four digits only — the full number is never stored */
  last4: string;
  /** 0 when the provider does not expose an expiry (Google Pay) */
  expMonth: number;
  expYear: number;
  holder: string;
  addedAt: string;
  provider?: PaymentProvider | undefined;
};

export const CARD_BRANDS: Record<Exclude<CardBrand, "card">, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  amex: "American Express",
  discover: "Discover",
};

export function brandLabel(brand: CardBrand): string {
  return brand === "card" ? "Card" : CARD_BRANDS[brand];
}

/** Detect the network from the leading digits. */
export function detectBrand(digits: string): CardBrand {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^6(?:011|5)/.test(digits)) return "discover";
  return "card";
}

/** Luhn checksum — catches typos and made-up numbers. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function cardNumberValid(digits: string): boolean {
  const len = digits.length;
  const amex = /^3[47]/.test(digits);
  const okLen = amex ? len === 15 : len >= 13 && len <= 19;
  return okLen && luhnValid(digits);
}

export function expiryValid(month: number, year: number, now = new Date()): boolean {
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  if (!Number.isInteger(year)) return false;
  const full = year < 100 ? 2000 + year : year;
  const end = new Date(full, month, 1); // first day of the month after expiry
  return end.getTime() > now.getTime();
}

export function cvcValid(cvc: string, brand: CardBrand): boolean {
  return brand === "amex" ? /^\d{4}$/.test(cvc) : /^\d{3,4}$/.test(cvc);
}

export type CardInput = {
  holder: string;
  number: string;
  expiry: string; // "MM/YY" or "MM/YYYY"
  cvc: string;
};

export type CardErrors = Partial<Record<keyof CardInput, string>>;

/** Validate the whole form. Returns an empty object when everything is good. */
export function validateCard(input: CardInput, now = new Date()): CardErrors {
  const errors: CardErrors = {};
  const digits = input.number.replace(/\D/g, "");
  const brand = detectBrand(digits);

  if (!input.holder.trim()) errors.holder = "Enter the name on the card";
  if (!digits) errors.number = "Enter your card number";
  else if (!cardNumberValid(digits)) errors.number = "That card number isn't valid";

  const m = input.expiry.match(/^\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*$/);
  if (!input.expiry.trim()) errors.expiry = "Enter the expiry date";
  else if (!m) errors.expiry = "Use MM/YY";
  else if (!expiryValid(Number(m[1]), Number(m[2]), now)) errors.expiry = "That card has expired";

  if (!input.cvc.trim()) errors.cvc = "Enter the security code";
  else if (!cvcValid(input.cvc, brand)) errors.cvc = brand === "amex" ? "4 digits" : "3 digits";

  return errors;
}

/** Turn a validated form into the record we keep. Never keeps the full PAN. */
export function toPaymentMethod(input: CardInput): PaymentMethod {
  const digits = input.number.replace(/\D/g, "");
  const m = input.expiry.match(/^\s*(\d{1,2})\s*\/\s*(\d{2,4})\s*$/)!;
  const year = Number(m[2]);
  return {
    provider: "card",
    brand: detectBrand(digits),
    last4: digits.slice(-4),
    expMonth: Number(m[1]),
    expYear: year < 100 ? 2000 + year : year,
    holder: input.holder.trim(),
    addedAt: new Date().toISOString(),
  };
}

/** "Visa •••• 4242" / "Google Pay •••• 1234" */
export function maskCard(pm: PaymentMethod): string {
  const brand = pm.provider === "googlepay" ? "Google Pay" : brandLabel(pm.brand);
  return pm.last4 && pm.last4 !== "0000" ? `${brand} •••• ${pm.last4}` : brand;
}

/** "09/28" — blank for wallets that don't expose an expiry. */
export function formatExpiry(pm: PaymentMethod): string {
  if (!pm.expMonth) return "on file";
  return `${String(pm.expMonth).padStart(2, "0")}/${String(pm.expYear).slice(-2)}`;
}

/** Human label for the provider, used on receipts and buttons. */
export function providerLabel(pm: PaymentMethod): string {
  if (pm.provider === "googlepay") return "Google Pay";
  if (pm.provider === "venmo") return "Venmo";
  return "Card";
}

/* -------------------------------------------------------------------------- */
/*  Subscription record                                                       */
/* -------------------------------------------------------------------------- */

/**
 * `expired` also covers the old `trial` status. Trials are no longer stored on
 * the subscription record — they live in `@/lib/trial` as a separate one-hour
 * grant — so any record still sitting on `trial` is treated as ended.
 */
export type SubStatus = "pending" | "active" | "expired";

export type Subscription = {
  planId: string;
  status: SubStatus;
  /** when the plan was first requested */
  startedAt: string;
  /** set once the owner confirms the Venmo payment */
  paidAt: string | null;
  /** card on file, used to renew the plan */
  paymentMethod: PaymentMethod | null;
  /** Where the plan came from. Missing means a normal paid subscription. */
  source?: "payment" | "code";
  /** The gift / promo code that granted this plan, when `source` is `code`. */
  code?: string | null;
  /** End of the current paid or redeemed period (ISO). */
  currentPeriodEnd?: string | null;
  /**
   * True for an owner-granted lifetime plan. Such a plan never expires, so
   * `currentPeriodEnd` is always null and must never be consulted.
   */
  isLifetime?: boolean;
  /** Who granted it - shown as "Given by @drewmclawhorn3". */
  grantedBy?: string | null;
};

/** Fired whenever the stored subscription changes, so the UI can re-render. */
export const SUBSCRIPTION_EVENT = "subscription-change";
const EVT = SUBSCRIPTION_EVENT;

/**
 * Payment methods are session-only. They are never written to localStorage,
 * cookies or any other device store; the subscription itself lives on the
 * account in `public.user_subscriptions`.
 */
const paymentMethods = new Map<string, PaymentMethod>();

/** Code strings are kept in memory so the "active via code" line can render. */
const codeGrants = new Map<string, string>();

function planLabel(planId: string): string {
  return planById(planId)?.label ?? planId;
}

function toAccountInput(sub: Subscription): AccountSubscriptionInput {
  return {
    planId: sub.planId,
    planName: planLabel(sub.planId),
    status:
      sub.status === "active" ? "active" : sub.status === "pending" ? "pending" : "expired",
    startedAt: sub.startedAt,
    expiresAt: sub.currentPeriodEnd ?? null,
    autoRenew: sub.status === "active" && sub.source !== "code",
  };
}

/** Turn an account row into the shape the rest of the app already understands. */
function fromAccountRow(row: AccountSubscriptionRow): Subscription {
  const status: SubStatus =
    row.status === "active" || row.status === "trialing"
      ? "active"
      : row.status === "pending"
        ? "pending"
        : "expired";
  // A row with an expiry date came from a fixed-length code grant; paid plans
  // renew monthly and keep `expires_at` null.
  const isCode = Boolean(row.expires_at);
  return {
    planId: row.plan_id,
    status,
    isLifetime: false,
    startedAt: row.started_at,
    paidAt: status === "active" ? row.started_at : null,
    paymentMethod: null,
    source: isCode ? "code" : "payment",
    code: codeGrants.get(row.plan_id) ?? null,
    currentPeriodEnd: row.expires_at,
  };
}

/**
 * The subscription in force for this handle.
 *
 * The account row is the source of truth. A lifetime grant still outranks
 * everything, and a revoked lifetime grant drops the user straight to the
 * paywall. There is no device fallback: signing in on a new phone hydrates
 * this cache from Supabase, so the plan follows the account.
 */
export function getSubscription(handle?: string | null): Subscription | null {
  if (!handle || typeof window === "undefined") return null;

  const lifetime = cachedLifetime(handle);
  if (isLifetimeRevoked(lifetime)) return null;

  // A real lifetime grant outranks everything: it never expires and cannot be
  // bought again.
  if (lifetime && isLifetimeActive(lifetime)) {
    return {
      planId: lifetime.plan,
      status: "active",
      startedAt: lifetime.grantedAt ?? new Date().toISOString(),
      paidAt: lifetime.grantedAt ?? null,
      paymentMethod: null,
      source: "payment",
      code: null,
      currentPeriodEnd: null,
      isLifetime: true,
      grantedBy: lifetime.grantedBy,
    };
  }

  const row = cachedAccountSubscription(handle);
  if (!row) return null;

  const sub = fromAccountRow(row);
  sub.paymentMethod = paymentMethods.get(handle) ?? null;
  return sub;
}

/** True when there is a usable card on file. */
export function hasPaymentMethod(handle?: string | null): boolean {
  return Boolean(getSubscription(handle)?.paymentMethod);
}

/**
 * Update the in-memory cache immediately, so the UI reacts on the same tick,
 * then persist the change to the account in the background.
 */
function write(handle: string, sub: Subscription | null) {
  if (sub) {
    if (sub.paymentMethod) paymentMethods.set(handle, sub.paymentMethod);
    if (sub.code) codeGrants.set(sub.planId, sub.code);
    const input = toAccountInput(sub);
    setCachedAccountSubscription(handle, input);
    void persistAccountSubscriptionForHandle(handle, input);
  } else {
    clearCachedAccountSubscription(handle);
  }
  window.dispatchEvent(new Event(EVT));
}

/** Update the card on an existing subscription. */
export function updatePaymentMethod(handle: string, pm: PaymentMethod) {
  paymentMethods.set(handle, pm);
  const existing = getSubscription(handle);
  if (!existing) {
    window.dispatchEvent(new Event(EVT));
    return;
  }
  write(handle, { ...existing, paymentMethod: pm });
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
    paidAt: null,
    paymentMethod: existing?.paymentMethod ?? null,
  });
}

/** Owner confirms the Venmo payment landed. */
export function confirmPayment(handle: string) {
  const existing = getSubscription(handle);
  if (!existing) return;
  write(handle, {
    ...existing,
    status: "active",
    paidAt: new Date().toISOString(),
    source: "payment",
    code: null,
    currentPeriodEnd: null,
  });
}

/**
 * Grant a plan from a redeemed subscription code.
 *
 * Codes are fixed-length (1, 3 or 12 months). If the user already has a live
 * code subscription, the new months stack on top of the current end date \u2014
 * exactly how a Netflix gift card extends an existing balance. Otherwise the
 * period starts now.
 */
export function applyCodeSubscription(
  handle: string,
  opts: { planId: string; code: string; months: number; endsAt?: string | null },
): Subscription {
  const existing = getSubscription(handle);
  const now = new Date();

  const existingEnd = existing?.currentPeriodEnd ? new Date(existing.currentPeriodEnd) : null;
  let end: Date;
  if (existing?.source === "code" && existingEnd && existingEnd.getTime() > now.getTime()) {
    end = new Date(existingEnd);
    end.setMonth(end.getMonth() + opts.months);
  } else if (opts.endsAt) {
    end = new Date(opts.endsAt);
  } else {
    end = new Date(now);
    end.setMonth(end.getMonth() + opts.months);
  }

  write(handle, {
    planId: opts.planId,
    status: "active",
    startedAt: existing?.startedAt ?? now.toISOString(),
    paidAt: now.toISOString(),
    paymentMethod: null,
    source: "code",
    code: opts.code,
    currentPeriodEnd: end.toISOString(),
  });

  return getSubscription(handle) as Subscription;
}

/**
 * Cancel the plan on the account. The row stays for history but is marked
 * cancelled, and the on-screen subscription is cleared immediately.
 */
export function cancelSubscription(handle: string) {
  const existing = getSubscription(handle);
  const planId = existing?.planId;
  paymentMethods.delete(handle);
  if (planId) codeGrants.delete(planId);
  clearCachedAccountSubscription(handle);
  window.dispatchEvent(new Event(EVT));
  if (planId) void cancelAccountSubscriptionForHandle(handle, planId);
}
/** True when the plan is giving them perks right now. */
export function isActive(sub: Subscription | null): boolean {
  return sub?.status === "active";
}

/* -------------------------------------------------------------------------- */
/*  Offline mode access                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The plan whose perks are live right now.
 *
 * A paid, active subscription wins; otherwise a running free hour supplies the
 * plan. Returns null when neither is in force.
 */
export function planInForce(handle?: string | null): string | null {
  const sub = getSubscription(handle);
  if (isActive(sub)) return sub?.planId ?? null;
  return activeTrial(handle)?.planId ?? null;
}

/** True when this plan's perks are live — paid for, or inside its free hour. */
export function hasPlanAccess(handle: string | null | undefined, planId: string): boolean {
  const inForce = planInForce(handle);
  // A lifetime "all" grant satisfies every plan, including ones added later.
  return inForce === planId || inForce === "all";
}

/** True while this plan's free hour is running. */
export function isTrialing(handle?: string | null, planId?: string | null): boolean {
  return isTrialActive(handle, planId);
}

/**
 * Offline *video* downloads are included on every paid tier (Plus, Pro and
 * VIP), with a one-hour free trial.
 *
 * Access requires a live subscription *and* a plan that includes the feature,
 * or a running free hour on a plan that includes it. Free accounts do not get
 * offline mode; a `pending` or `expired` subscription does not count either:
 * the plan has to be paid and active for the offline library to unlock.
 * Offline *music* is gated separately at VIP — see `hasMusicOfflineAccess`.
 */
export function hasOfflineAccess(handle?: string | null): boolean {
  const trial = activeTrial(handle);
  if (trial && planIncludesOffline(trial.planId)) return true;
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesOffline(sub?.planId);
}

/**
 * Offline *music* downloads are a VIP-and-up perk, with a one-hour free trial.
 *
 * Pro keeps offline video downloads, but music is gated at VIP. A running free
 * hour on VIP (or the lifetime "all access" grant) unlocks it; Pro and Plus do
 * not. The same paid-and-active rule as `hasOfflineAccess` applies.
 */
export function hasMusicOfflineAccess(handle?: string | null): boolean {
  const trial = activeTrial(handle);
  if (trial && planIncludesMusicOffline(trial.planId)) return true;
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesMusicOffline(sub?.planId);
}

/**
 * Background play is a VIP-and-up perk, with a one-hour free trial.
 *
 * Pro keeps offline video downloads, but audio that keeps running once the app
 * is hidden is gated at VIP. A running free hour on VIP (or the lifetime "all
 * access" grant) unlocks it; Plus and Pro do not. The same paid-and-active rule
 * as `hasOfflineAccess` applies, so a pending or expired plan stays locked.
 */
export function hasBackgroundPlayAccess(handle?: string | null): boolean {
  const trial = activeTrial(handle);
  if (trial && planIncludesBackgroundPlay(trial.planId)) return true;
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesBackgroundPlay(sub?.planId);
}

/** True when the plan alone unlocks background play, ignoring any trial. */
export function planUnlocksBackgroundPlay(handle?: string | null): boolean {
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesBackgroundPlay(sub?.planId);
}

/** True when the plan alone unlocks offline music, ignoring any trial. */
export function planUnlocksMusicOffline(handle?: string | null): boolean {
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesMusicOffline(sub?.planId);
}

/** True when the plan alone unlocks offline mode, ignoring any trial. */
export function planUnlocksOffline(handle?: string | null): boolean {
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesOffline(sub?.planId);
}

/**
 * Reactive `planUnlocksOffline`.
 *
 * Reads the plan on the first render, then re-reads whenever the local record
 * changes, the server-side grant changes, or the window regains focus. It also
 * asks the server once on mount, so a plan applied in the database unlocks the
 * offline surfaces without a reload.
 */
export function useOfflineUnlocked(handle?: string | null): boolean {
  const [unlocked, setUnlocked] = useState(() => planUnlocksOffline(handle));

  useEffect(() => {
    const sync = () => setUnlocked(planUnlocksOffline(handle));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
    window.addEventListener(LIFETIME_EVENT, sync);
    window.addEventListener("focus", sync);
    // Pull the account's plan from Supabase, then re-render from the cache.
    void refreshAccountSubscription(handle).then(sync);
    void refreshLifetime(handle).then(sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
      window.removeEventListener(LIFETIME_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [handle]);

  return unlocked;
}

/** Why offline mode is locked, so the UI can say something useful. */
export type OfflineLockReason =
  "signed-out" | "no-plan" | "plan-lacks-offline" | "expired" | "trial-ended";

export function offlineLockReason(handle?: string | null): OfflineLockReason | null {
  if (hasOfflineAccess(handle)) return null;
  if (!handle) return "signed-out";
  const sub = getSubscription(handle);
  // The offline prompt starts a trial of the cheapest offline plan, but a
  // viewer may have trialed a higher tier instead, so check every plan that
  // includes offline video before deciding they never had an hour.
  if (!sub) {
    const usedAnyOfflineTrial = PLANS.filter((p) => p.offline).some((p) =>
      hasUsedTrial(handle, p.id),
    );
    return usedAnyOfflineTrial ? "trial-ended" : "no-plan";
  }
  if (sub.status === "expired" || sub.status === "pending") return "expired";
  return "plan-lacks-offline";
}

/** Why offline *music* is locked, so the Music tab can say something useful. */
export function musicOfflineLockReason(handle?: string | null): OfflineLockReason | null {
  if (hasMusicOfflineAccess(handle)) return null;
  if (!handle) return "signed-out";
  const sub = getSubscription(handle);
  if (!sub) {
    const usedAnyMusicTrial = PLANS.filter((p) => p.musicOffline).some((p) =>
      hasUsedTrial(handle, p.id),
    );
    return usedAnyMusicTrial ? "trial-ended" : "no-plan";
  }
  if (sub.status === "expired" || sub.status === "pending") return "expired";
  return "plan-lacks-offline";
}

/** Why background play is locked, so the Music tab can say something useful. */
export function backgroundPlayLockReason(handle?: string | null): OfflineLockReason | null {
  if (hasBackgroundPlayAccess(handle)) return null;
  if (!handle) return "signed-out";
  const sub = getSubscription(handle);
  if (!sub) {
    const usedAnyBackgroundTrial = PLANS.filter((p) => p.backgroundPlay).some((p) =>
      hasUsedTrial(handle, p.id),
    );
    return usedAnyBackgroundTrial ? "trial-ended" : "no-plan";
  }
  if (sub.status === "expired" || sub.status === "pending") return "expired";
  return "plan-lacks-offline";
}

/**
 * Reactive subscription for this handle.
 *
 * Seeds from the in-memory cache so the first paint is instant, then hydrates
 * from `public.user_subscriptions` on mount and on focus. There is no device
 * fallback: a fresh phone gets the plan from the account.
 */
export function useSubscription(handle?: string | null) {
  const [sub, setSub] = useState<Subscription | null>(() => getSubscription(handle));

  useEffect(() => {
    const sync = () => setSub(getSubscription(handle));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
    window.addEventListener(LIFETIME_EVENT, sync);
    // Re-check on focus so a plan bought, cancelled or restored elsewhere
    // updates mid-session.
    window.addEventListener("focus", sync);
    // Ask Supabase for the account's plan, then re-render from the cache.
    void refreshAccountSubscription(handle).then(sync);
    void refreshLifetime(handle).then(sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
      window.removeEventListener(LIFETIME_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [handle]);

  return sub;
}

/**
 * Force a fresh read of the account's subscription. Used by the
 * "Restore Subscription" button in Settings.
 */
export async function restoreSubscription(handle?: string | null): Promise<Subscription | null> {
  await refreshAccountSubscription(handle);
  window.dispatchEvent(new Event(EVT));
  return getSubscription(handle);
}
