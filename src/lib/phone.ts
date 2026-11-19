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
  let trimmed = value.trim();
  if (!trimmed) return null;

  // If the user pasted a full "+..." number onto an existing "+..." prefix,
  // keep from the last "+" onward instead of concatenating two country codes.
  const firstPlus = trimmed.indexOf("+");
  const lastPlus = trimmed.lastIndexOf("+");
  if (firstPlus !== -1 && lastPlus > firstPlus) {
    trimmed = trimmed.slice(lastPlus);
  }

  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // International access prefix: 00 44 ... -> 44 ...
  if (digits.startsWith("00")) digits = digits.slice(2);

  const hadPlus = trimmed.startsWith("+");

  // Bare 10-digit North American number -> assume +1.
  if (!hadPlus && digits.length === 10) digits = `1${digits}`;

  // If "+1" was prefilled and the user pasted an 11-digit "1..." number on top,
  // strip the accidental doubled "1" (there is no +11 country code in E.164).
  if (digits.length === 12 && digits.startsWith("11")) digits = digits.slice(1);

  // A leading 0 is never a country code; drop it and let the rest stand.
  if (!hadPlus && digits.startsWith("0")) digits = digits.replace(/^0+/, "");

  // Zone 1 (+1 NANP) numbers are always exactly 11 digits (1 + 10 digits).
  if (digits.startsWith("1") && digits.length !== 11) return null;

  const candidate = `+${digits}`;
  return E164.test(candidate) ? candidate : null;
}

/** Supabase errors are accurate but not always actionable. Translate the common ones. */
export function explainAuthError(message: string, fallback: string): string {
  const m = message.toLowerCase();
  if (m.includes("not configured in this preview environment")) {
    return "Phone verification isn't connected in this preview environment (Supabase keys are missing). Test phone sign-in on your live Lovable / Supabase app or add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.";
  }
  if (
    (m.includes("provider") &&
      (m.includes("disabled") || m.includes("not enabled") || m.includes("unsupported"))) ||
    (m.includes("phone") && m.includes("disabled"))
  ) {
    return "Phone sign-in isn't switched on for this app yet. Use email, Apple or Google — or enable the Phone provider in Supabase → Auth → Providers.";
  }
  if (m.includes("signups not allowed")) {
    return "New phone sign-ups are turned off in Supabase Auth settings. Turn on 'Allow new users to sign up' or sign in with an existing account.";
  }
  if (
    (m.includes("sms") &&
      (m.includes("disabled") || m.includes("not configured") || m.includes("failed"))) ||
    m.includes("error sending confirmation otp") ||
    m.includes("unable to get sms")
  ) {
    return `Text messages aren't configured or failed to send (${message}). Check your Twilio / SMS settings in Supabase → Auth → Providers → Phone.`;
  }
  if (m.includes("rate limit") || m.includes("too many") || m.includes("security purposes")) {
    return "Too many attempts. Wait a minute, then try again.";
  }
  // Supabase returns "Token has expired or is invalid" for both wrong codes and expired codes.
  if (m.includes("expired") && m.includes("invalid")) {
    return "That code is wrong or expired. Double-check the 6 digits and try again, or tap Resend code for a new one.";
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
