import { describe, expect, it } from "vitest";
import { explainAuthError, normalizePhone } from "@/lib/phone";

/**
 * Supabase rejects anything that isn't strict E.164 before it ever sends an SMS,
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

  it("rejects junk instead of sending an SMS into the void", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("+")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("+0123456789")).toBeNull();
  });
});

describe("explainAuthError", () => {
  it("turns a disabled provider into an actionable message", () => {
    expect(explainAuthError("Phone provider is disabled", "fallback")).toContain("Supabase");
  });

  it("explains rate limits", () => {
    expect(
      explainAuthError(
        "For security purposes, you can only request this once every 60 seconds",
        "x",
      ),
    ).toContain("Too many attempts");
  });

  it("explains expired codes", () => {
    expect(explainAuthError("Token has expired or is invalid", "x")).toContain("expired");
  });

  it("falls back to the original message", () => {
    expect(explainAuthError("Something odd happened", "fallback")).toBe("Something odd happened");
    expect(explainAuthError("", "fallback")).toBe("fallback");
  });
});
