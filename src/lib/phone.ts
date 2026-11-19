/**
 * Phone-number helpers for Firebase SMS sign-up.
 *
 * Firebase's `signInWithPhoneNumber` only accepts strict E.164 ("+15551234567"),
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

export const FREE_SMS_LIMIT_MESSAGE =
  "Free daily text limit reached — please use Google or Email for now, phone texts reset tomorrow";

/** Auth errors are accurate but not always actionable. Translate the common ones. */
export function explainAuthError(message: string, fallback: string, code?: string): string {
  const c = (code ?? "").toLowerCase();
  const m = message.toLowerCase();

  if (
    c === "auth/quota-exceeded" ||
    c === "auth/too-many-requests" ||
    m.includes("quota-exceeded") ||
    m.includes("too-many-requests") ||
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("security purposes") ||
    (m.includes("daily") && m.includes("limit")) ||
    (m.includes("sms") && m.includes("quota"))
  ) {
    return FREE_SMS_LIMIT_MESSAGE;
  }

  if (
    c === "firebase/not-configured" ||
    (m.includes("firebase") && m.includes("not configured")) ||
    m.includes("not configured in this preview environment")
  ) {
    return "Phone verification needs your Firebase project keys (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID) in your environment. You can use Google or Email right now.";
  }

  if (m.includes("region") && (m.includes("sms") || m.includes("operation-not-allowed"))) {
    return "SMS isn't enabled for this country/region in Firebase yet. Allow your region (e.g. United States +1) in Firebase Authentication → Settings → SMS region policy, or use Google or Email.";
  }

  if (c === "auth/billing-not-enabled" || m.includes("billing-not-enabled")) {
    return "Firebase requires a Blaze plan to send Phone SMS (first 10 SMS/day are free). Enable Blaze in Firebase Console or use Google or Email.";
  }

  if (
    c === "auth/operation-not-allowed" ||
    m.includes("operation-not-allowed") ||
    (m.includes("provider") &&
      (m.includes("disabled") || m.includes("not enabled") || m.includes("unsupported"))) ||
    (m.includes("phone") && m.includes("disabled"))
  ) {
    return "Phone sign-in isn't enabled in Firebase yet. Enable Phone in Firebase Authentication → Sign-in method (and check Authentication → Settings → SMS region policy), or use Google or Email.";
  }

  if (c === "auth/unauthorized-domain" || m.includes("unauthorized-domain")) {
    return "This domain isn't authorized for Firebase Phone Auth yet. Add it in Firebase → Authentication → Settings → Authorized domains, or use Google or Email.";
  }

  if (c === "auth/captcha-check-failed" || m.includes("captcha")) {
    return "Verification check couldn't complete. Please try again, or use Google or Email.";
  }

  if (
    c === "auth/code-expired" ||
    m.includes("code-expired") ||
    (m.includes("expired") && !m.includes("invalid"))
  ) {
    return "That code expired. Tap Resend code to get a new one.";
  }

  if (m.includes("expired") && m.includes("invalid")) {
    return "That code is wrong or expired. Double-check the 6 digits and try again, or tap Resend code for a new one.";
  }

  if (
    c === "auth/invalid-verification-code" ||
    c === "auth/missing-verification-code" ||
    m.includes("invalid-verification-code") ||
    (m.includes("invalid") && m.includes("token"))
  ) {
    return "Wrong code — check the 6 digits and try again.";
  }

  if (
    c === "auth/invalid-phone-number" ||
    c === "auth/missing-phone-number" ||
    m.includes("invalid-phone-number") ||
    m.includes("missing-phone-number") ||
    (m.includes("invalid") && (m.includes("phone") || m.includes("number")))
  ) {
    return "That number doesn't look valid. Include the country code, e.g. +1 555 123 4567.";
  }

  return message || fallback;
}
