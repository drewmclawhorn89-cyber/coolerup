import { useEffect, useState } from "react";

import {
  ALL_ACCESS_FOREVER_PLAN,
  LIFETIME_PLAN,
  PLANS,
  backgroundPlayPlan,
  fetchPlansFromDb,
  getPlans,
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
  cachedAccountSubscriptionForUser,
  cancelAccountSubscriptionForHandle,
  clearCachedAccountSubscription,
  currentAccountUserId,
  isAccountSubscriptionLoading,
  loadAccountSubscription,
  persistAccountSubscriptionForHandle,
  refreshAccountSubscription,
  saveAccountSubscription,
  setCachedAccountSubscription,
  type AccountSubscriptionInput,
  type AccountSubscriptionRow,
  type AccountSubscriptionStatus,
} from "@/lib/accountSubscriptions";
import {
  LIFETIME_EVENT,
  cachedLifetime,
  isLifetimeActive,
  isLifetimeRevoked,
  isOwnerHandle,
  lifetimePlanLabel,
  refreshLifetime,
} from "@/lib/subscription";

export type { Plan };
export {
  ALL_ACCESS_FOREVER_PLAN,
  LIFETIME_PLAN,
  PLANS,
  fetchPlansFromDb,
  getPlans,
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

function paymentMethodFromLabel(
  rawLabel: string | null | undefined,
  addedAt: string,
): PaymentMethod | null {
  const label = (rawLabel ?? "").trim();
  if (!label || label.startsWith("Code:")) return null;
  const lower = label.toLowerCase();
  const last4Match = label.match(/(\d{4})$/);
  const last4 = last4Match?.[1] ?? "0000";
  if (lower.startsWith("google pay")) {
    return {
      provider: "googlepay",
      brand: "card",
      last4,
      expMonth: 0,
      expYear: 0,
      holder: "Google Pay",
      addedAt,
    };
  }
  if (lower.startsWith("venmo")) {
    return {
      provider: "venmo",
      brand: "card",
      last4: "0000",
      expMonth: 0,
      expYear: 0,
      holder: "Venmo",
      addedAt,
    };
  }
  const brand: CardBrand = lower.includes("visa")
    ? "visa"
    : lower.includes("mastercard")
      ? "mastercard"
      : lower.includes("american express") || lower.includes("amex")
        ? "amex"
        : lower.includes("discover")
          ? "discover"
          : "card";
  return {
    provider: "card",
    brand,
    last4,
    expMonth: 0,
    expYear: 0,
    holder: label,
    addedAt,
  };
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

/** Fired whenever the subscription cache changes, so the UI can re-render. */
export const SUBSCRIPTION_EVENT = "subscription-change";
const EVT = SUBSCRIPTION_EVENT;

/** Session-only parsed payment method objects; safe display label lives in Supabase. */
const paymentMethods = new Map<string, PaymentMethod>();

/** Code strings are kept in memory so the "active via code" line can render. */
const codeGrants = new Map<string, string>();

function planLabel(planId: string): string {
  if (planId === "free") return "Free";
  if (planId === "all") return "All Access Forever";
  return planById(planId)?.label ?? planId;
}

export function subscriptionDisplayName(sub?: Subscription | null): string {
  if (!sub || (sub.status !== "active" && sub.status !== "pending")) return "Free";
  if (sub.isLifetime || sub.planId === "all") return lifetimePlanLabel(sub.planId);
  return planLabel(sub.planId);
}

function isExpiredDate(expiresAt?: string | null): boolean {
  if (!expiresAt) return false;
  const ms = Date.parse(expiresAt);
  return Number.isFinite(ms) && ms <= Date.now();
}

function toAccountInput(sub: Subscription): AccountSubscriptionInput {
  const isForever = sub.planId === "all" || Boolean(sub.isLifetime);
  return {
    planId: sub.planId,
    planName: isForever ? "All Access Forever" : planLabel(sub.planId),
    status: sub.status === "active" ? "active" : sub.status === "pending" ? "pending" : "expired",
    startedAt: sub.startedAt,
    expiresAt: isForever ? null : (sub.currentPeriodEnd ?? null),
    paymentMethod: sub.paymentMethod
      ? maskCard(sub.paymentMethod)
      : sub.source === "code" && sub.code
        ? `Code: ${sub.code}`
        : null,
    paymentVerified:
      sub.status === "active" && (Boolean(sub.paymentMethod) || sub.source === "code"),
    autoRenew: !isForever && sub.status === "active" && sub.source !== "code",
  };
}

/**
 * Turn an account row into the app Subscription shape, enforcing:
 * - Default is Free (never Forever) when no row or status is free/cancelled/expired.
 * - Monthly/Yearly plans check expires_at: past expires_at => expired ("Free").
 * - All Access Forever requires plan_name = "All Access Forever" AND
 *   plan_status = "active" AND payment_verified = true (or owner handle).
 */
function fromAccountRow(row: AccountSubscriptionRow, handle?: string | null): Subscription | null {
  const rawStatus = String(row.plan_status ?? row.status ?? "free").toLowerCase();
  const planId = (row.plan_id ?? "").trim();
  const planName = (row.plan_name ?? "").trim();

  if (!planId || planId === "free" || rawStatus === "free") {
    return null;
  }

  const isForever = planId === "all" || /all access forever|lifetime all access/i.test(planName);

  if (isForever) {
    const validForever =
      planName === "All Access Forever" &&
      rawStatus === "active" &&
      (row.payment_verified === true || isOwnerHandle(handle));
    if (!validForever) {
      return null;
    }
    return {
      planId: "all",
      status: "active",
      isLifetime: true,
      startedAt: row.started_at,
      paidAt: row.started_at,
      paymentMethod: paymentMethodFromLabel(row.payment_method, row.updated_at),
      source: "payment",
      code: null,
      currentPeriodEnd: null,
    };
  }

  let status: SubStatus;
  if (rawStatus === "cancelled" || rawStatus === "canceled" || rawStatus === "expired") {
    status = "expired";
  } else if (
    (rawStatus === "active" || rawStatus === "trialing") &&
    isExpiredDate(row.expires_at)
  ) {
    status = "expired";
  } else if (rawStatus === "active" || rawStatus === "trialing") {
    status = "active";
  } else if (rawStatus === "pending") {
    status = "pending";
  } else {
    status = "expired";
  }

  const isCode = row.payment_method
    ? row.payment_method.startsWith("Code:")
    : Boolean(row.expires_at);
  const code =
    row.payment_method && row.payment_method.startsWith("Code:")
      ? row.payment_method.slice("Code:".length).trim()
      : (codeGrants.get(row.plan_id) ?? null);
  return {
    planId: row.plan_id,
    status,
    isLifetime: false,
    startedAt: row.started_at,
    paidAt: status === "active" ? row.started_at : null,
    paymentMethod: paymentMethodFromLabel(row.payment_method, row.updated_at),
    source: isCode ? "code" : "payment",
    code,
    currentPeriodEnd: row.expires_at,
  };
}

/**
 * The subscription in force for this handle (and/or userId).
 *
 * Default is ALWAYS Free (null) when no paid row exists.
 * Owner @drewmclawhorn3 keeps their plan without copying it to other users.
 * Zero device/localStorage fallback is ever consulted.
 */
export function getSubscription(
  handle?: string | null,
  userId?: string | null,
): Subscription | null {
  if ((!handle && !userId) || typeof window === "undefined") return null;

  const lifetime = handle ? cachedLifetime(handle) : null;
  if (!isOwnerHandle(handle) && isLifetimeRevoked(lifetime)) return null;

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

  const row =
    (userId ? cachedAccountSubscriptionForUser(userId) : null) ??
    (handle ? cachedAccountSubscription(handle) : null);
  if (!row) return null;

  const sub = fromAccountRow(row, handle);
  if (!sub) return null;
  if (handle && !sub.paymentMethod) {
    sub.paymentMethod = paymentMethods.get(handle) ?? null;
  }
  return sub;
}

/** True when there is a usable card on file. */
export function hasPaymentMethod(handle?: string | null): boolean {
  return Boolean(getSubscription(handle)?.paymentMethod);
}

/**
 * Updates in-memory cache immediately and triggers a background DB persist.
 * Use `saveSubscriptionToAccount` when callers need to await confirmation.
 */
function write(handle: string, sub: Subscription | null) {
  if (sub) {
    if (sub.paymentMethod) paymentMethods.set(handle, sub.paymentMethod);
    if (sub.code) codeGrants.set(sub.planId, sub.code);
    const input = toAccountInput(sub);
    setCachedAccountSubscription(handle, input);
    void persistAccountSubscriptionForHandle(handle, input).catch(() => {
      // Background sync for synchronous unit helpers; interactive purchases await `saveSubscriptionToAccount`.
    });
  } else {
    clearCachedAccountSubscription(handle);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

/**
 * Saves or updates the single subscription row for `user_id` in Supabase.
 * Awaits the real database write and throws if saving fails.
 */
export async function saveSubscriptionToAccount(params: {
  userId?: string | null | undefined;
  handle: string;
  planId: string;
  planName?: string | null | undefined;
  status: AccountSubscriptionStatus;
  paymentMethod?: PaymentMethod | string | null | undefined;
  paymentVerified?: boolean | undefined;
  startedAt?: string | undefined;
  expiresAt?: string | null | undefined;
  source?: "payment" | "code" | undefined;
  code?: string | null | undefined;
}): Promise<Subscription> {
  const userId = params.userId || (await currentAccountUserId());
  if (!userId) {
    throw new Error("Sign in to save your subscription to your account.");
  }

  const now = new Date();
  const isForever = params.planId === "all" || params.planName === "All Access Forever";
  const startedAt = params.startedAt ?? now.toISOString();
  const nextMonth = new Date(now);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const expiresAt = isForever
    ? null
    : params.expiresAt !== undefined
      ? params.expiresAt
      : params.status === "active"
        ? nextMonth.toISOString()
        : null;

  let pmObj: PaymentMethod | null = null;
  let pmLabel: string | null = null;
  if (typeof params.paymentMethod === "string") {
    pmLabel = params.paymentMethod;
    pmObj = paymentMethodFromLabel(pmLabel, now.toISOString());
  } else if (params.paymentMethod) {
    pmObj = params.paymentMethod;
    pmLabel = maskCard(params.paymentMethod);
  } else if (params.source === "code" && params.code) {
    pmLabel = `Code: ${params.code}`;
  }

  const paymentVerified = params.paymentVerified ?? Boolean(params.status === "active" && pmLabel);

  if (isForever && params.status === "active" && !paymentVerified) {
    throw new Error("All Access Forever requires a verified payment.");
  }

  if (pmObj) paymentMethods.set(params.handle, pmObj);
  if (params.code) codeGrants.set(params.planId, params.code);

  const row = await saveAccountSubscription(userId, {
    planId: params.planId,
    planName: isForever ? "All Access Forever" : (params.planName ?? planLabel(params.planId)),
    status: params.status,
    startedAt,
    expiresAt,
    paymentMethod: pmLabel,
    paymentVerified,
    autoRenew: !isForever && params.status === "active" && params.source !== "code",
  });

  await loadAccountSubscription(userId, params.handle);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));

  const hydrated = getSubscription(params.handle, userId);
  if (hydrated) return hydrated;
  const fallbackSub = row ? fromAccountRow(row, params.handle) : null;
  if (fallbackSub) return fallbackSub;
  throw new Error("Could not verify saved subscription.");
}

/** Cancels the account subscription row in Supabase (`plan_status = 'cancelled'`). */
export async function cancelSubscriptionOnAccount(params: {
  userId?: string | null | undefined;
  handle: string;
  planId?: string | undefined;
}): Promise<void> {
  const existing = getSubscription(params.handle, params.userId);
  const targetPlanId = params.planId ?? existing?.planId;
  paymentMethods.delete(params.handle);
  if (targetPlanId) codeGrants.delete(targetPlanId);
  clearCachedAccountSubscription(params.handle);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
  await cancelAccountSubscriptionForHandle(params.handle, targetPlanId, params.userId);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
}

/** Update the card on an existing subscription. */
export function updatePaymentMethod(handle: string, pm: PaymentMethod) {
  paymentMethods.set(handle, pm);
  const existing = getSubscription(handle);
  if (!existing) {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
    return;
  }
  write(handle, { ...existing, paymentMethod: pm });
}

/**
 * Mark a plan pending until payment clears (Venmo / offline helper).
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
 * Cancel the plan on the account.
 */
export function cancelSubscription(handle: string) {
  const existing = getSubscription(handle);
  const planId = existing?.planId;
  paymentMethods.delete(handle);
  if (planId) codeGrants.delete(planId);
  clearCachedAccountSubscription(handle);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
  if (planId) {
    void cancelAccountSubscriptionForHandle(handle, planId).catch(() => {
      // Ignored in synchronous unit helpers.
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
    const usedAnyOfflineTrial = getPlans()
      .filter((p) => p.offline)
      .some((p) => hasUsedTrial(handle, p.id));
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
    const usedAnyMusicTrial = getPlans()
      .filter((p) => p.musicOffline)
      .some((p) => hasUsedTrial(handle, p.id));
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
    const usedAnyBackgroundTrial = getPlans()
      .filter((p) => p.backgroundPlay)
      .some((p) => hasUsedTrial(handle, p.id));
    return usedAnyBackgroundTrial ? "trial-ended" : "no-plan";
  }
  if (sub.status === "expired" || sub.status === "pending") return "expired";
  return "plan-lacks-offline";
}

/**
 * Reactive subscription + loading state for this account.
 *
 * When a user is signed in, `loading` stays true until Supabase has returned
 * their account subscription so the UI shows a spinner instead of flashing "Free".
 */
export function useSubscriptionState(
  handle?: string | null,
  userId?: string | null,
): { subscription: Subscription | null; loading: boolean } {
  const [sub, setSub] = useState<Subscription | null>(() => getSubscription(handle, userId));
  const [loading, setLoading] = useState<boolean>(() =>
    Boolean(userId && isAccountSubscriptionLoading(handle, userId) && !isOwnerHandle(handle)),
  );

  useEffect(() => {
    let alive = true;
    const sync = () => {
      if (!alive) return;
      setSub(getSubscription(handle, userId));
      setLoading(
        Boolean(userId && isAccountSubscriptionLoading(handle, userId) && !isOwnerHandle(handle)),
      );
    };
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
    window.addEventListener(LIFETIME_EVENT, sync);
    window.addEventListener("focus", sync);

    if (userId || handle) {
      Promise.all([refreshAccountSubscription(handle, userId), refreshLifetime(handle)]).finally(
        sync,
      );
    }

    return () => {
      alive = false;
      window.removeEventListener(EVT, sync);
      window.removeEventListener(ACCOUNT_SUBSCRIPTION_EVENT, sync);
      window.removeEventListener(LIFETIME_EVENT, sync);
      window.removeEventListener("focus", sync);
    };
  }, [handle, userId]);

  return { subscription: sub, loading };
}

/**
 * Reactive subscription for this handle (and optional userId).
 */
export function useSubscription(handle?: string | null, userId?: string | null) {
  return useSubscriptionState(handle, userId).subscription;
}

/**
 * Force a fresh read of the account's subscription from Supabase by user_id.
 * Returns null when the account has no active/paid plan (never invents a plan).
 */
export async function restoreSubscription(
  handle?: string | null,
  userId?: string | null,
): Promise<Subscription | null> {
  if (!handle && !userId) return null;
  if (handle) clearCachedAccountSubscription(handle);
  await Promise.all([refreshAccountSubscription(handle, userId), refreshLifetime(handle)]);
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVT));
  const restored = getSubscription(handle, userId);
  if (!restored || restored.status !== "active") return null;
  return restored;
}
