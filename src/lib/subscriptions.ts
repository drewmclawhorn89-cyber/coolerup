import { useEffect, useState } from "react";

import {
  LIFETIME_PLAN,
  PLANS,
  backgroundPlayPlan,
  musicOfflinePlan,
  offlinePlan,
  planById,
  planIncludesBackgroundPlay,
  planIncludesMusicOffline,
  planIncludesOffline,
  type Plan,
} from "@/lib/plans";
import { activeTrial, hasUsedTrial, isTrialActive } from "@/lib/trial";
import {
  ACCOUNT_SUBSCRIPTION_EVENT,
  cachedAccountSubscription,
  cancelAccountSubscriptionForHandle,
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
  LIFETIME_PLAN,
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
  if (pm.provider === "venmo") return "Venmo";
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

export type SubStatus = "pending" | "active" | "expired";

export type Subscription = {
  planId: string;
  status: SubStatus;
  /** when the plan was first requested */
  startedAt: string;
  /** set once confirmed */
  paidAt: string | null;
  /** card/wallet on file */
  paymentMethod: PaymentMethod | null;
  /** Where the plan came from. Missing means a normal paid subscription. */
  source?: "payment" | "code";
  /** The gift / promo code that granted this plan, when `source` is `code`. */
  code?: string | null;
  /** End of the current paid or redeemed period (ISO). */
  currentPeriodEnd?: string | null;
  /** True for an owner-granted lifetime plan. */
  isLifetime?: boolean;
  /** Who granted it - shown as "Given by @drewmclawhorn3". */
  grantedBy?: string | null;
};

/** Fired whenever the subscription changes, so the UI can re-render. */
export const SUBSCRIPTION_EVENT = "subscription-change";
const EVT = SUBSCRIPTION_EVENT;
const key = (handle: string) => `sub:${handle}`;

function toAccountInput(sub: Subscription): AccountSubscriptionInput {
  return {
    planId: sub.planId,
    planName: planById(sub.planId)?.label ?? sub.planId,
    status: sub.status === "active" ? "active" : sub.status === "pending" ? "pending" : "expired",
    startedAt: sub.startedAt,
    expiresAt: sub.currentPeriodEnd ?? null,
    autoRenew: sub.status === "active" && sub.source !== "code",
  };
}

function fromAccountRow(row: AccountSubscriptionRow): Subscription {
  const status: SubStatus =
    row.status === "active" || row.status === "trialing"
      ? "active"
      : row.status === "pending"
        ? "pending"
        : "expired";
  return {
    planId: row.plan_id,
    status,
    isLifetime: false,
    startedAt: row.started_at,
    paidAt: status === "active" ? row.started_at : null,
    paymentMethod: null,
    source: row.expires_at ? "code" : "payment",
    code: null,
    currentPeriodEnd: row.expires_at,
  };
}

function readRaw(handle: string): Subscription | null {
  try {
    const raw = localStorage.getItem(key(handle));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Subscription>;
    if (!parsed.planId) return null;
    return {
      planId: parsed.planId,
      status: parsed.status ?? "expired",
      startedAt: parsed.startedAt ?? new Date().toISOString(),
      paidAt: parsed.paidAt ?? null,
      paymentMethod: parsed.paymentMethod ?? null,
      source: parsed.source,
      code: parsed.code ?? null,
      currentPeriodEnd: parsed.currentPeriodEnd ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * The subscription in force for this handle (device record + account sync +
 * server lifetime grants).
 */
export function getSubscription(handle?: string | null): Subscription | null {
  if (!handle || typeof window === "undefined") return null;

  const lifetime = cachedLifetime(handle);
  if (isLifetimeRevoked(lifetime)) return null;

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

  const device = readRaw(handle);
  if (device) return device;

  const account = cachedAccountSubscription(handle);
  return account ? fromAccountRow(account) : null;
}

/** True when there is a usable card on file. */
export function hasPaymentMethod(handle?: string | null): boolean {
  return Boolean(getSubscription(handle)?.paymentMethod);
}

function write(handle: string, sub: Subscription | null) {
  if (sub) {
    localStorage.setItem(key(handle), JSON.stringify(sub));
    const input = toAccountInput(sub);
    setCachedAccountSubscription(handle, input);
    void persistAccountSubscriptionForHandle(handle, input).catch(() => {
      /* background sync */
    });
  } else {
    localStorage.removeItem(key(handle));
    clearCachedAccountSubscription(handle);
  }
  window.dispatchEvent(new Event(EVT));
}

/** Update the card on an existing subscription. */
export function updatePaymentMethod(handle: string, pm: PaymentMethod) {
  const existing = getSubscription(handle);
  if (!existing) return;
  write(handle, { ...existing, paymentMethod: pm });
}

/**
 * Mark a plan pending until payment clears.
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

/** Mark the current pending subscription active. */
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
 * Cancel the plan on the device and account.
 */
export function cancelSubscription(handle: string) {
  const existing = getSubscription(handle);
  const planId = existing?.planId;
  write(handle, null);
  if (planId) {
    void cancelAccountSubscriptionForHandle(handle, planId).catch(() => {
      /* background sync */
    });
  }
}

/** True when the plan is giving them perks right now. */
export function isActive(sub: Subscription | null): boolean {
  return sub?.status === "active";
}

/* -------------------------------------------------------------------------- */
/*  Offline mode access                                                       */
/* -------------------------------------------------------------------------- */

export function planInForce(handle?: string | null): string | null {
  const sub = getSubscription(handle);
  if (isActive(sub)) return sub?.planId ?? null;
  return activeTrial(handle)?.planId ?? null;
}

export function hasPlanAccess(handle: string | null | undefined, planId: string): boolean {
  const inForce = planInForce(handle);
  return inForce === planId || inForce === "all";
}

export function isTrialing(handle?: string | null, planId?: string | null): boolean {
  return isTrialActive(handle, planId);
}

export function hasOfflineAccess(handle?: string | null): boolean {
  const trial = activeTrial(handle);
  if (trial && planIncludesOffline(trial.planId)) return true;
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesOffline(sub?.planId);
}

export function hasMusicOfflineAccess(handle?: string | null): boolean {
  const trial = activeTrial(handle);
  if (trial && planIncludesMusicOffline(trial.planId)) return true;
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesMusicOffline(sub?.planId);
}

export function hasBackgroundPlayAccess(handle?: string | null): boolean {
  const trial = activeTrial(handle);
  if (trial && planIncludesBackgroundPlay(trial.planId)) return true;
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesBackgroundPlay(sub?.planId);
}

export function planUnlocksBackgroundPlay(handle?: string | null): boolean {
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesBackgroundPlay(sub?.planId);
}

export function planUnlocksMusicOffline(handle?: string | null): boolean {
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesMusicOffline(sub?.planId);
}

export function planUnlocksOffline(handle?: string | null): boolean {
  const sub = getSubscription(handle);
  if (!isActive(sub)) return false;
  return planIncludesOffline(sub?.planId);
}

export function useOfflineUnlocked(handle?: string | null): boolean {
  const [unlocked, setUnlocked] = useState(() => planUnlocksOffline(handle));

  useEffect(() => {
    const sync = () => setUnlocked(planUnlocksOffline(handle));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
    window.addEventListener(LIFETIME_EVENT, sync);
    window.addEventListener("focus", sync);
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
  if (!sub) {
    const usedAnyOfflineTrial = PLANS.filter((p) => p.offline).some((p) =>
      hasUsedTrial(handle, p.id),
    );
    return usedAnyOfflineTrial ? "trial-ended" : "no-plan";
  }
  if (sub.status === "expired" || sub.status === "pending") return "expired";
  return "plan-lacks-offline";
}

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
 */
export function useSubscription(handle?: string | null) {
  const [sub, setSub] = useState<Subscription | null>(() => getSubscription(handle));

  useEffect(() => {
    const sync = () => setSub(getSubscription(handle));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
    window.addEventListener(LIFETIME_EVENT, sync);
    window.addEventListener("focus", sync);
    void refreshAccountSubscription(handle);
    void refreshLifetime(handle);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
      window.removeEventListener(LIFETIME_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [handle]);

  return sub;
}
