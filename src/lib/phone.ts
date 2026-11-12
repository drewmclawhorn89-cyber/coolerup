/**
 * Phone-number helpers for SMS sign-up.
 *
 * Supabase's `signInWithOtp({ phone })` only accepts strict E.164 ("+15551234567"),
 * so anything the user types has to be normalised first — otherwise the request is
 * rejected before an SMS is ever sent.
 */

const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Turn whatever the user typed into E.164, or null when it can't be a real number.
 * Handles the cases people actually type: "+1 (555) 123-4567", "5551234567",
 * "0015551234567", and numbers with a stray leading zero.
 */
export function normalizePhone(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // International access prefix: 00 44 ... -> 44 ...
  if (digits.startsWith("00")) digits = digits.slice(2);

  const hadPlus = trimmed.startsWith("+");

  // Bare 10-digit North American number -> assume +1 (matches the "+1" default).
  if (!hadPlus && digits.length === 10) digits = `1${digits}`;

  // A leading 0 is never a country code; drop it and let the rest stand.
  if (!hadPlus && digits.startsWith("0")) digits = digits.replace(/^0+/, "");

  const candidate = `+${digits}`;
  return E164.test(candidate) ? candidate : null;
}

/** Supabase errors are accurate but not always actionable. Translate the common ones. */
export function explainAuthError(message: string, fallback: string): string {
  const m = message.toLowerCase();
  if (m.includes("provider") && (m.includes("disabled") || m.includes("not enabled"))) {
    return "Phone sign-in isn't switched on for this app yet. Use email, Apple or Google — or enable the Phone provider in Supabase → Auth → Providers.";
  }
  if (m.includes("sms") && (m.includes("disabled") || m.includes("not configured"))) {
    return "Text messages aren't configured for this app yet. Use email, Apple or Google instead.";
  }
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes")) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  if (m.includes("expired")) {
    return "That code expired. Tap Resend code to get a new one.";
  }
  if (m.includes("invalid") && (m.includes("phone") || m.includes("number"))) {
    return "That number doesn't look valid. Include the country code, e.g. +1 555 123 4567.";
  }
  if (m.includes("invalid") && m.includes("token")) {
    return "Wrong code — check the 6 digits and try again.";
  }
  return message || fallback;
}
