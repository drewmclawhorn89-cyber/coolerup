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
  /** card on file — required before a trial can start */
  paymentMethod: PaymentMethod | null;
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
      paymentMethod: null,
    };
  }
  // Legacy "active" plan with no dates — treat as active, no trial left.
  return {
    planId: raw,
    status: "active",
    startedAt: now.toISOString(),
    trialEndsAt: now.toISOString(),
    paidAt: now.toISOString(),
    paymentMethod: null,
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
  if (!sub) return null;
  // Records written before the card gate existed have no paymentMethod key.
  const normalized: Subscription = { ...sub, paymentMethod: sub.paymentMethod ?? null };
  return withCurrentStatus(normalized);
}

/** True when there is a usable card on file. */
export function hasPaymentMethod(handle?: string | null): boolean {
  return Boolean(getSubscription(handle)?.paymentMethod);
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

/**
 * Start the 7 day free trial. A card on file is required first — the card is
 * not charged today, but it is what gets billed when the trial ends.
 * Throws if no valid payment method was supplied.
 */
export function startTrial(
  handle: string,
  planId: string,
  paymentMethod: PaymentMethod,
): Subscription {
  if (!paymentMethod) {
    throw new Error("A payment method is required to start the trial");
  }
  const now = new Date();
  const sub: Subscription = {
    planId,
    status: "trial",
    startedAt: now.toISOString(),
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
    paidAt: null,
    paymentMethod,
  };
  localStorage.setItem(usedKey(handle), "1");
  write(handle, sub);
  return sub;
}

/** When the first real charge happens if they don't cancel. */
export function firstChargeDate(sub: Subscription | null): Date | null {
  if (!sub || sub.status !== "trial") return null;
  return new Date(sub.trialEndsAt);
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
    trialEndsAt:
      existing?.trialEndsAt ?? new Date(now.getTime() + TRIAL_DAYS * DAY_MS).toISOString(),
    paidAt: null,
    paymentMethod: existing?.paymentMethod ?? null,
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
