import { useEffect, useState } from "react";

import {
  PLANS,
  planById,
  planIncludesMusicOffline,
  planIncludesOffline,
  musicOfflinePlan,
  offlinePlan,
  type Plan,
} from "@/lib/plans";
import { activeTrial, hasUsedTrial, isTrialActive } from "@/lib/trial";
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
  planIncludesMusicOffline,
  planIncludesOffline,
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

const key = (handle: string) => `subscription:${handle}`;
const EVT = "subscription-change";

/**
 * Old versions stored a bare string ("pro" or "pending:pro"). Turn anything we
 * find into the current shape so existing users don't lose their plan.
 */
function migrate(raw: string): Subscription | null {
  if (!raw) return null;
  if (raw.startsWith("{")) {
    try {
      const parsed = JSON.parse(raw) as Subscription & { trialEndsAt?: string };
      return normalize(parsed);
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
      paidAt: null,
      paymentMethod: null,
    };
  }
  // Legacy "active" plan with no dates.
  return {
    planId: raw,
    status: "active",
    startedAt: now.toISOString(),
    paidAt: now.toISOString(),
    paymentMethod: null,
  };
}

/**
 * Drops fields we no longer use and retires the old `trial` status, so a plan
 * only ever reads as pending, active or expired.
 */
function normalize(sub: Subscription & { trialEndsAt?: string; status?: string }): Subscription {
  // A code redemption is a fixed-length grant, so it expires on its own even if
  // nobody touches the record. Paid plans keep the existing pending/active
  // behaviour.
  const codeEnded =
    sub.source === "code" &&
    Boolean(sub.currentPeriodEnd) &&
    new Date(sub.currentPeriodEnd as string).getTime() <= Date.now();
  const status: SubStatus = codeEnded
    ? "expired"
    : sub.status === "active" || sub.status === "pending"
      ? sub.status
      : "expired";
  return {
    planId: sub.planId,
    status,
    startedAt: sub.startedAt,
    paidAt: sub.paidAt ?? null,
    paymentMethod: sub.paymentMethod ?? null,
    source: sub.source === "code" ? "code" : "payment",
    code: sub.code ?? null,
    currentPeriodEnd: sub.currentPeriodEnd ?? null,
  };
}

/**
 * The subscription in force for this handle.
 *
 * A lifetime grant outranks everything: it is read from the server-backed cache
 * first, and while it is active it is returned as-is with no expiry, so it still
 * works in ten years. A *revoked* grant returns null instead of falling back to
 * localStorage, which is what drops the user back to the paywall immediately
 * rather than letting an old paid plan or code linger.
 */
export function getSubscription(handle?: string | null): Subscription | null {
  if (!handle || typeof window === "undefined") return null;

  const lifetime = cachedLifetime(handle);
  if (isLifetimeRevoked(lifetime)) return null;
  if (isLifetimeActive(lifetime) && lifetime) {
    return {
      planId: lifetime.plan,
      status: "active",
      startedAt: lifetime.grantedAt ?? new Date().toISOString(),
      paidAt: lifetime.grantedAt ?? null,
      paymentMethod: null,
      source: "payment",
      code: null,
      // Never expires. Deliberately null, and never read while isLifetime.
      currentPeriodEnd: null,
      isLifetime: true,
      grantedBy: lifetime.grantedBy,
    };
  }

  const raw = localStorage.getItem(key(handle));
  if (!raw) return null;
  return migrate(raw);
}

/** True when there is a usable card on file. */
export function hasPaymentMethod(handle?: string | null): boolean {
  return Boolean(getSubscription(handle)?.paymentMethod);
}

function write(handle: string, sub: Subscription | null) {
  if (sub) localStorage.setItem(key(handle), JSON.stringify(sub));
  else localStorage.removeItem(key(handle));
  window.dispatchEvent(new Event(EVT));
}

/** Update the card on an existing subscription. */
export function updatePaymentMethod(handle: string, pm: PaymentMethod) {
  const existing = getSubscription(handle);
  if (!existing) return;
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
 * code subscription, the new months stack on top of the current end date —
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

export function cancelSubscription(handle: string) {
  write(handle, null);
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
 * Offline downloads are a Pro-and-up perk, with a one-hour free trial.
 *
 * Access requires a live subscription *and* a plan that includes the feature,
 * or a running free hour on a plan that includes it. Trialing Plus does not
 * unlock offline mode, because Plus does not include it; trialing Pro or VIP
 * does. A `pending` or `expired` subscription does not count: the plan has to
 * be paid and active for the offline library to unlock.
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

/** Why offline mode is locked, so the UI can say something useful. */
export type OfflineLockReason =
  "signed-out" | "no-plan" | "plan-lacks-offline" | "expired" | "trial-ended";

export function offlineLockReason(handle?: string | null): OfflineLockReason | null {
  if (hasOfflineAccess(handle)) return null;
  if (!handle) return "signed-out";
  const sub = getSubscription(handle);
  // The offline prompt starts a trial of the cheapest offline plan, so that is
  // the hour whose exhaustion matters here.
  if (!sub) return hasUsedTrial(handle, offlinePlan().id) ? "trial-ended" : "no-plan";
  if (sub.status === "expired" || sub.status === "pending") return "expired";
  return "plan-lacks-offline";
}

/** Why offline *music* is locked, so the Music tab can say something useful. */
export function musicOfflineLockReason(handle?: string | null): OfflineLockReason | null {
  if (hasMusicOfflineAccess(handle)) return null;
  if (!handle) return "signed-out";
  const sub = getSubscription(handle);
  if (!sub) return hasUsedTrial(handle, musicOfflinePlan().id) ? "trial-ended" : "no-plan";
  if (sub.status === "expired" || sub.status === "pending") return "expired";
  return "plan-lacks-offline";
}

export function useSubscription(handle?: string | null) {
  const [sub, setSub] = useState<Subscription | null>(null);
  useEffect(() => {
    const sync = () => setSub(getSubscription(handle));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener(LIFETIME_EVENT, sync);
    // Re-check on focus so a plan cancelled - or a lifetime grant revoked -
    // elsewhere updates mid-session.
    window.addEventListener("focus", sync);
    // Ask the server whether a lifetime grant exists, then re-render from cache.
    void refreshLifetime(handle);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener(LIFETIME_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [handle]);
  return sub;
}
