/**
 * Venmo helpers for coin purchases.
 *
 * Venmo has no public "charge a stranger" API, so the flow is a pre-filled
 * payment request plus a short order code the buyer types into the Venmo note.
 * Everything here is pure so it can be unit tested without a network or a
 * browser.
 */

/** Characters that survive being read aloud and typed on a phone keyboard. */
const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const REFERENCE_PREFIX = "CU-";

/**
 * The Coolerup Venmo account. `VENMO_RECIPIENT` overrides this, but the same
 * handle already receives subscription payments, so coin purchases work
 * without extra configuration.
 */
export const DEFAULT_VENMO_RECIPIENT = "Samantha-Barnes-168";
export const REFERENCE_BODY_LENGTH = 6;

export type VenmoOrderStatus = "awaiting_payment" | "submitted" | "paid" | "rejected" | "canceled";

/**
 * Build a reference code such as `CU-7K3QX9`.
 *
 * `random` is injectable so tests are deterministic; it must return a number in
 * [0, 1) the way `Math.random` does.
 */
export function makeReferenceCode(random: () => number = Math.random): string {
  let body = "";
  for (let i = 0; i < REFERENCE_BODY_LENGTH; i += 1) {
    const raw = random();
    const safe = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999) : 0;
    body += CODE_ALPHABET[Math.floor(safe * CODE_ALPHABET.length)];
  }
  return `${REFERENCE_PREFIX}${body}`;
}

/** `CU-7k3qx9 ` -> `CU-7K3QX9`. Returns null when it can't be a real code. */
export function normalizeReferenceCode(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().toUpperCase().replace(/\s+/g, "");
  const withPrefix = cleaned.startsWith(REFERENCE_PREFIX)
    ? cleaned
    : `${REFERENCE_PREFIX}${cleaned}`;
  const body = withPrefix.slice(REFERENCE_PREFIX.length);
  if (body.length !== REFERENCE_BODY_LENGTH) return null;
  for (const char of body) {
    if (!CODE_ALPHABET.includes(char)) return null;
  }
  return withPrefix;
}

/** Venmo usernames are letters, digits, dashes and underscores. */
export function normalizeVenmoHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/^@+/, "");
  if (!/^[A-Za-z0-9_-]{3,30}$/.test(cleaned)) return null;
  return cleaned;
}

/** 499 -> "4.99". Never uses floats for the integer part. */
export function amountString(cents: number): string {
  const safe = Math.max(0, Math.round(Number.isFinite(cents) ? cents : 0));
  const whole = Math.floor(safe / 100);
  const part = String(safe % 100).padStart(2, "0");
  return `${whole}.${part}`;
}

/** The note the buyer should paste into Venmo so the payment can be matched. */
export function buildVenmoNote(referenceCode: string): string {
  return `Coolerup coins ${referenceCode}`;
}

export type VenmoPayLinkInput = {
  handle: string;
  cents: number;
  referenceCode: string;
};

/**
 * Universal link. On a phone Venmo intercepts this and opens the app; on
 * desktop it lands on the Venmo site with the payment pre-filled.
 */
export function venmoPayUrl({ handle, cents, referenceCode }: VenmoPayLinkInput): string {
  const recipient = normalizeVenmoHandle(handle) ?? handle.trim().replace(/^@+/, "");
  const params = new URLSearchParams({
    txn: "pay",
    recipients: recipient,
    amount: amountString(cents),
    note: buildVenmoNote(referenceCode),
  });
  return `https://venmo.com/?${params.toString()}`;
}

/** App-only scheme, offered as a secondary "open the app" button. */
export function venmoAppUrl({ handle, cents, referenceCode }: VenmoPayLinkInput): string {
  const recipient = normalizeVenmoHandle(handle) ?? handle.trim().replace(/^@+/, "");
  const params = new URLSearchParams({
    txn: "pay",
    recipients: recipient,
    amount: amountString(cents),
    note: buildVenmoNote(referenceCode),
  });
  return `venmo://paycharge?${params.toString()}`;
}

export function venmoProfileUrl(handle: string): string {
  const recipient = normalizeVenmoHandle(handle) ?? handle.trim().replace(/^@+/, "");
  return `https://venmo.com/u/${encodeURIComponent(recipient)}`;
}

export const VENMO_STATUS_LABEL: Record<VenmoOrderStatus, string> = {
  awaiting_payment: "Waiting for your payment",
  submitted: "Checking your payment",
  paid: "Coins added",
  rejected: "Payment not found",
  canceled: "Canceled",
};

export function venmoStatusLabel(status: string): string {
  return VENMO_STATUS_LABEL[status as VenmoOrderStatus] ?? status;
}

export type StatusTone = "pending" | "good" | "bad" | "muted";

export function venmoStatusTone(status: string): StatusTone {
  switch (status) {
    case "submitted":
      return "pending";
    case "paid":
      return "good";
    case "rejected":
      return "bad";
    default:
      return "muted";
  }
}

/** Can the buyer (re)submit proof of payment for this order? */
export function canSubmitVenmoPayment(status: string): boolean {
  return status === "awaiting_payment" || status === "rejected";
}

/** Is this order still waiting on an admin, i.e. worth polling for? */
export function isVenmoOrderOpen(status: string): boolean {
  return status === "awaiting_payment" || status === "submitted";
}
