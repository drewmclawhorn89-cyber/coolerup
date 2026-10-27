import { beforeEach, describe, expect, it } from "vitest";
import {
  TRIAL_DAYS,
  canStartTrial,
  cancelSubscription,
  cardNumberValid,
  confirmPayment,
  detectBrand,
  expiryValid,
  firstChargeDate,
  formatExpiry,
  getSubscription,
  hasPaymentMethod,
  hasUsedTrial,
  isActive,
  luhnValid,
  maskCard,
  requestPayment,
  startTrial,
  toPaymentMethod,
  trialDaysLeft,
  updatePaymentMethod,
  validateCard,
  type PaymentMethod,
} from "@/lib/subscriptions";

const H = "tester";

const CARD: PaymentMethod = {
  brand: "visa",
  last4: "4242",
  expMonth: 9,
  expYear: 2032,
  holder: "Alex Morgan",
  addedAt: new Date().toISOString(),
};

beforeEach(() => localStorage.clear());

describe("card validation", () => {
  it("accepts a valid visa", () => {
    expect(luhnValid("4242424242424242")).toBe(true);
    expect(cardNumberValid("4242424242424242")).toBe(true);
  });

  it("rejects a bad checksum", () => {
    expect(luhnValid("4242424242424241")).toBe(false);
  });

  it("detects brands", () => {
    expect(detectBrand("4242424242424242")).toBe("visa");
    expect(detectBrand("5555555555554444")).toBe("mastercard");
    expect(detectBrand("378282246310005")).toBe("amex");
    expect(detectBrand("6011111111111117")).toBe("discover");
  });

  it("validates amex length (15) vs visa (16)", () => {
    expect(cardNumberValid("378282246310005")).toBe(true);
    expect(cardNumberValid("37828224631000")).toBe(false);
  });

  it("rejects expired cards", () => {
    expect(expiryValid(12, 2020)).toBe(false);
    expect(expiryValid(1, 2035)).toBe(true);
  });

  it("flags every empty field", () => {
    const errs = validateCard({ holder: "", number: "", expiry: "", cvc: "" });
    expect(Object.keys(errs).sort()).toEqual(["cvc", "expiry", "holder", "number"]);
  });

  it("passes a complete valid form", () => {
    expect(
      validateCard({ holder: "Alex", number: "4242 4242 4242 4242", expiry: "09/32", cvc: "123" }),
    ).toEqual({});
  });

  it("never keeps the full number", () => {
    const pm = toPaymentMethod({
      holder: "Alex",
      number: "4242 4242 4242 4242",
      expiry: "09/32",
      cvc: "123",
    });
    expect(pm.last4).toBe("4242");
    expect(JSON.stringify(pm)).not.toContain("4242424242424242");
    expect(maskCard(pm)).toBe("Visa •••• 4242");
  });
});

describe("7 day free trial requires a card", () => {
  it("refuses to start without a payment method", () => {
    // @ts-expect-error deliberately omitting the required card
    expect(() => startTrial(H, "pro")).toThrow(/payment method is required/i);
    expect(getSubscription(H)).toBeNull();
  });

  it("starts once a card is supplied", () => {
    const sub = startTrial(H, "pro", CARD);
    expect(sub.status).toBe("trial");
    expect(sub.paidAt).toBeNull();
    expect(sub.paymentMethod?.last4).toBe("4242");
    expect(trialDaysLeft(sub)).toBe(TRIAL_DAYS);
    expect(isActive(sub)).toBe(true);
    expect(hasPaymentMethod(H)).toBe(true);
  });

  it("trial end is exactly 7 days out", () => {
    const sub = startTrial(H, "plus", CARD);
    const ms = new Date(sub.trialEndsAt).getTime() - new Date(sub.startedAt).getTime();
    expect(Math.round(ms / 86400000)).toBe(TRIAL_DAYS);
  });

  it("reports the first charge date", () => {
    const sub = startTrial(H, "vip", CARD);
    expect(firstChargeDate(sub)?.toISOString()).toBe(sub.trialEndsAt);
  });

  it("counts down days", () => {
    const sub = startTrial(H, "pro", CARD);
    localStorage.setItem(
      `subscription:${H}`,
      JSON.stringify({ ...sub, trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString() }),
    );
    expect(trialDaysLeft(getSubscription(H))).toBe(3);
  });

  it("expires when the clock passes trialEndsAt", () => {
    const sub = startTrial(H, "vip", CARD);
    localStorage.setItem(
      `subscription:${H}`,
      JSON.stringify({ ...sub, trialEndsAt: new Date(Date.now() - 1000).toISOString() }),
    );
    const got = getSubscription(H);
    expect(got?.status).toBe("expired");
    expect(isActive(got)).toBe(false);
    expect(trialDaysLeft(got)).toBe(0);
  });

  it("only allows one trial per account", () => {
    expect(canStartTrial(H)).toBe(true);
    startTrial(H, "pro", CARD);
    expect(hasUsedTrial(H)).toBe(true);
    expect(canStartTrial(H)).toBe(false);
    cancelSubscription(H);
    expect(canStartTrial(H)).toBe(false);
  });

  it("trial -> pending -> active", () => {
    startTrial(H, "pro", CARD);
    requestPayment(H, "pro");
    expect(getSubscription(H)?.status).toBe("pending");
    expect(getSubscription(H)?.paymentMethod?.last4).toBe("4242");
    confirmPayment(H);
    const s = getSubscription(H);
    expect(s?.status).toBe("active");
    expect(s?.paidAt).toBeTruthy();
    expect(isActive(s)).toBe(true);
  });

  it("can swap the card mid-trial", () => {
    startTrial(H, "pro", CARD);
    updatePaymentMethod(H, { ...CARD, last4: "1111", brand: "mastercard" });
    expect(getSubscription(H)?.paymentMethod?.last4).toBe("1111");
    expect(getSubscription(H)?.status).toBe("trial");
  });

  it("accepts a Google Pay method with no expiry", () => {
    const gpay = {
      provider: "googlepay" as const,
      brand: "visa" as const,
      last4: "1234",
      expMonth: 0,
      expYear: 0,
      holder: "Google Pay",
      addedAt: new Date().toISOString(),
    };
    startTrial(H, "plus", gpay);
    expect(getSubscription(H)?.paymentMethod?.provider).toBe("googlepay");
    expect(hasPaymentMethod(H)).toBe(true);
    expect(maskCard(gpay)).toBe("Google Pay \u2022\u2022\u2022\u2022 1234");
    expect(formatExpiry(gpay)).toBe("on file");
  });

  it("labels an opaque wallet token without digits", () => {
    const gpay = {
      provider: "googlepay" as const,
      brand: "card" as const,
      last4: "0000",
      expMonth: 0,
      expYear: 0,
      holder: "Google Pay",
      addedAt: new Date().toISOString(),
    };
    expect(maskCard(gpay)).toBe("Google Pay");
  });

  it("migrates the old bare-string format", () => {
    localStorage.setItem(`subscription:${H}`, "pending:pro");
    expect(getSubscription(H)?.status).toBe("pending");
    localStorage.setItem(`subscription:${H}`, "vip");
    expect(getSubscription(H)?.status).toBe("active");
  });
});
