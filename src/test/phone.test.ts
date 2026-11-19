import { describe, expect, it } from "vitest";
import { FREE_SMS_LIMIT_MESSAGE, explainAuthError, normalizePhone } from "@/lib/phone";

/**
 * Firebase rejects anything that isn't strict E.164 before it ever sends an SMS,
 * so normalisation is the difference between "code sent" and a dead sign-up.
 */
describe("normalizePhone", () => {
  it("keeps already-valid E.164 numbers", () => {
    expect(normalizePhone("+15551234567")).toBe("+15551234567");
    expect(normalizePhone("+447911123456")).toBe("+447911123456");
  });

  it("strips the formatting people actually type", () => {
    expect(normalizePhone("+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("+1 555.123.4567")).toBe("+15551234567");
    expect(normalizePhone("  +1 555 123 4567  ")).toBe("+15551234567");
  });

  it("assumes +1 for a bare 10-digit number", () => {
    expect(normalizePhone("5551234567")).toBe("+15551234567");
    expect(normalizePhone("(555) 123-4567")).toBe("+15551234567");
  });

  it("accepts a country code without the plus", () => {
    expect(normalizePhone("15551234567")).toBe("+15551234567");
    expect(normalizePhone("447911123456")).toBe("+447911123456");
  });

  it("handles the 00 international prefix", () => {
    expect(normalizePhone("00447911123456")).toBe("+447911123456");
  });

  it("recovers when a user pastes a full number after the prefilled +1", () => {
    expect(normalizePhone("+1+1 (555) 123-4567")).toBe("+15551234567");
    expect(normalizePhone("+1+447911123456")).toBe("+447911123456");
    expect(normalizePhone("+115551234567")).toBe("+15551234567");
  });

  it("rejects junk and malformed +1 lengths instead of sending an SMS into the void", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("+")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
    expect(normalizePhone("+1555123456")).toBeNull();
    expect(normalizePhone("+155512345678")).toBeNull();
  });
});

describe("explainAuthError", () => {
  it("shows the exact free daily SMS limit message on quota errors and never mentions Twilio", () => {
    const quotaMsg = explainAuthError(
      "Firebase: Error (auth/quota-exceeded).",
      "x",
      "auth/quota-exceeded",
    );
    expect(quotaMsg).toBe(FREE_SMS_LIMIT_MESSAGE);
    expect(quotaMsg).toBe(
      "Free daily text limit reached — please use Google or Email for now, phone texts reset tomorrow",
    );

    const rateMsg = explainAuthError("Too many requests", "x", "auth/too-many-requests");
    expect(rateMsg).toBe(FREE_SMS_LIMIT_MESSAGE);
    expect(quotaMsg.toLowerCase()).not.toContain("twilio");
  });

  it("turns a disabled provider into a Firebase-specific actionable message", () => {
    const msg = explainAuthError("Operation not allowed", "fallback", "auth/operation-not-allowed");
    expect(msg).toContain("Firebase");
    expect(msg.toLowerCase()).not.toContain("twilio");
  });

  it("explains SMS region policy blocks accurately", () => {
    const msg = explainAuthError(
      "OPERATION_NOT_ALLOWED : SMS unable to be sent until this region enabled by the app developer.",
      "fallback",
      "auth/operation-not-allowed",
    );
    expect(msg).toContain("SMS region policy");
    expect(msg.toLowerCase()).not.toContain("twilio");
  });

  it("explains Firebase billing-not-enabled errors without crashing", () => {
    const msg = explainAuthError(
      "Firebase: Error (auth/billing-not-enabled).",
      "fallback",
      "auth/billing-not-enabled",
    );
    expect(msg).toContain("Blaze");
    expect(msg).toContain("Google or Email");
  });

  it("explains missing Firebase env configuration clearly", () => {
    const msg = explainAuthError(
      "Firebase Phone Auth is not configured in environment variables.",
      "fallback",
      "firebase/not-configured",
    );
    expect(msg).toContain("VITE_FIREBASE_API_KEY");
    expect(msg).toContain("Google or Email");
    expect(msg.toLowerCase()).not.toContain("twilio");
  });

  it("explains expired or invalid codes clearly", () => {
    expect(explainAuthError("Code expired", "x", "auth/code-expired")).toContain(
      "That code expired",
    );
    expect(explainAuthError("Invalid code", "x", "auth/invalid-verification-code")).toContain(
      "Wrong code",
    );
    const combined = explainAuthError("Token has expired or is invalid", "x");
    expect(combined).toContain("expired");
    expect(combined).toContain("wrong");
  });

  it("explains invalid phone numbers clearly", () => {
    expect(explainAuthError("Invalid phone number", "x", "auth/invalid-phone-number")).toContain(
      "country code",
    );
  });

  it("falls back to the original message", () => {
    expect(explainAuthError("Something odd happened", "fallback")).toBe("Something odd happened");
    expect(explainAuthError("", "fallback")).toBe("fallback");
  });
});
