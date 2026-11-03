import { beforeEach, describe, expect, it } from "vitest";
import {
  cancelSubscription,
  cardNumberValid,
  confirmPayment,
  detectBrand,
  expiryValid,
  formatExpiry,
  getSubscription,
  hasPaymentMethod,
  isActive,
  luhnValid,
  maskCard,
  requestPayment,
  toPaymentMethod,
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
    expect(maskCard(pm)).toBe("Visa \u2022\u2022\u2022\u2022 4242");
  });
});

describe("paid subscriptions only \u2014 no free trial", () => {
  it("starts at pending and only activates once the payment is confirmed", () => {
    requestPayment(H, "pro");
    const pending = getSubscription(H);
    expect(pending?.status).toBe("pending");
    expect(pending?.paidAt).toBeNull();
    expect(isActive(pending)).toBe(false);

    confirmPayment(H);
    const active = getSubscription(H);
    expect(active?.status).toBe("active");
    expect(active?.paidAt).toBeTruthy();
    expect(isActive(active)).toBe(true);
  });

  it("keeps the card on file across the payment request", () => {
    requestPayment(H, "pro");
    updatePaymentMethod(H, CARD);
    expect(getSubscription(H)?.paymentMethod?.last4).toBe("4242");
    expect(hasPaymentMethod(H)).toBe(true);
    expect(getSubscription(H)?.status).toBe("pending");
  });

  it("can swap the card on an active plan", () => {
    requestPayment(H, "pro");
    updatePaymentMethod(H, CARD);
    confirmPayment(H);
    updatePaymentMethod(H, { ...CARD, last4: "1111", brand: "mastercard" });
    expect(getSubscription(H)?.paymentMethod?.last4).toBe("1111");
    expect(getSubscription(H)?.status).toBe("active");
  });

  it("treats a legacy trial record as expired", () => {
    localStorage.setItem(
      `subscription:${H}`,
      JSON.stringify({
        planId: "pro",
        status: "trial",
        startedAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        paidAt: null,
        paymentMethod: CARD,
      }),
    );
    const sub = getSubscription(H);
    expect(sub?.status).toBe("expired");
    expect(isActive(sub)).toBe(false);
    expect(sub?.paymentMethod?.last4).toBe("4242");
  });

  it("drops the retired trialEndsAt field when reading a record", () => {
    localStorage.setItem(
      `subscription:${H}`,
      JSON.stringify({
        planId: "vip",
        status: "active",
        startedAt: new Date().toISOString(),
        trialEndsAt: new Date().toISOString(),
        paidAt: new Date().toISOString(),
        paymentMethod: null,
      }),
    );
    const sub = getSubscription(H);
    expect(sub).not.toBeNull();
    expect(Object.keys(sub!).sort()).toEqual([
      "paidAt",
      "paymentMethod",
      "planId",
      "startedAt",
      "status",
    ]);
  });

  it("clears the plan on cancel", () => {
    requestPayment(H, "plus");
    confirmPayment(H);
    cancelSubscription(H);
    expect(getSubscription(H)).toBeNull();
    expect(isActive(null)).toBe(false);
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
    requestPayment(H, "plus");
    updatePaymentMethod(H, gpay);
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
