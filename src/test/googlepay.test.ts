import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests pin down the two bugs that made Google Pay unusable:
 *
 *  1. `isReadyToPay` was called without `existingPaymentMethodRequired: false`,
 *     so Chrome on desktop answered "not ready" and the button stayed disabled.
 *  2. Starting a trial passed a $0.00 FINAL total, which Google Pay rejects.
 */

type Req = Record<string, unknown>;

class FakePaymentsClient {
  static lastIsReadyToPay: Req | null = null;
  static lastLoadPaymentData: Req | null = null;
  static nextPaymentData: Req | null = null;

  constructor(public opts: Req) {}

  async isReadyToPay(req: Req) {
    FakePaymentsClient.lastIsReadyToPay = req;
    return { result: true };
  }

  async loadPaymentData(req: Req) {
    FakePaymentsClient.lastLoadPaymentData = req;
    return FakePaymentsClient.nextPaymentData ?? undefined;
  }
}

const STRIPE_TOKEN = JSON.stringify({
  id: "tok_1PxyzAbcDefGhiJkl",
  card: { last4: "4242", brand: "Visa", exp_month: 9, exp_year: 2032 },
});

function installGooglePay(paymentData: Req | null) {
  FakePaymentsClient.nextPaymentData = paymentData;
  (window as unknown as { google: unknown }).google = {
    pay: { api: { PaymentsClient: FakePaymentsClient } },
  };
}

beforeEach(() => {
  vi.resetModules();
  FakePaymentsClient.lastIsReadyToPay = null;
  FakePaymentsClient.lastLoadPaymentData = null;
  delete (window as unknown as { google?: unknown }).google;
});

describe("googlePayAvailable", () => {
  it("asks for readiness without requiring a saved card", async () => {
    installGooglePay(null);
    const { googlePayAvailable } = await import("@/lib/googlepay");

    await expect(googlePayAvailable()).resolves.toBe(true);

    const req = FakePaymentsClient.lastIsReadyToPay;
    expect(req).not.toBeNull();
    expect(req?.["existingPaymentMethodRequired"]).toBe(false);
  });

  it("reports unavailable when the script is blocked", async () => {
    // Simulate a network/CSP block: the injected script errors immediately.
    const realAppend = document.head.appendChild.bind(document.head);
    const spy = vi
      .spyOn(document.head, "appendChild")
      .mockImplementation(<T extends Node>(node: T): T => {
        if (node instanceof HTMLScriptElement) {
          queueMicrotask(() => node.dispatchEvent(new Event("error")));
          return node;
        }
        return realAppend(node);
      });

    const { googlePayAvailable } = await import("@/lib/googlepay");
    await expect(googlePayAvailable()).resolves.toBe(false);
    spy.mockRestore();
  });
});

describe("requestGooglePay", () => {
  it("uses NOT_CURRENTLY_KNOWN for a zero-amount trial save", async () => {
    installGooglePay({
      paymentMethodData: [{ tokenizationData: { token: STRIPE_TOKEN }, info: {} }],
    });
    const { requestGooglePay } = await import("@/lib/googlepay");

    await requestGooglePay(0, "Pro trial");

    const info = FakePaymentsClient.lastLoadPaymentData?.["transactionInfo"] as Req;
    expect(info["totalPriceStatus"]).toBe("NOT_CURRENTLY_KNOWN");
    expect(info["totalPrice"]).toBeUndefined();
  });

  it("uses a FINAL total for a real charge", async () => {
    installGooglePay({
      paymentMethodData: [{ tokenizationData: { token: STRIPE_TOKEN }, info: {} }],
    });
    const { requestGooglePay } = await import("@/lib/googlepay");

    await requestGooglePay(9.99, "Pro");

    const info = FakePaymentsClient.lastLoadPaymentData?.["transactionInfo"] as Req;
    expect(info["totalPriceStatus"]).toBe("FINAL");
    expect(info["totalPrice"]).toBe("9.99");
    expect(info["currencyCode"]).toBe("USD");
  });

  it("parses the Stripe token into a payment method", async () => {
    installGooglePay({
      paymentMethodData: [{ tokenizationData: { token: STRIPE_TOKEN }, info: {} }],
    });
    const { requestGooglePay } = await import("@/lib/googlepay");

    const out = await requestGooglePay(9.99, "Pro");
    expect(out.ok).toBe(true);
    if (!out.ok) return;

    expect(out.token).toBe("tok_1PxyzAbcDefGhiJkl");
    expect(out.paymentMethod.provider).toBe("googlepay");
    expect(out.paymentMethod.brand).toBe("visa");
    expect(out.paymentMethod.last4).toBe("4242");
    expect(out.paymentMethod.expMonth).toBe(9);
    expect(out.paymentMethod.expYear).toBe(2032);
  });

  it("treats a dismissed sheet as cancelled, not failed", async () => {
    installGooglePay(null);
    const { requestGooglePay } = await import("@/lib/googlepay");

    const out = await requestGooglePay(9.99, "Pro");
    expect(out).toEqual({ ok: false, reason: "cancelled" });
  });

  it("fails cleanly when the sheet returns no token", async () => {
    installGooglePay({ paymentMethodData: [{ tokenizationData: { token: "" }, info: {} }] });
    const { requestGooglePay } = await import("@/lib/googlepay");

    const out = await requestGooglePay(9.99, "Pro");
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.reason).toBe("failed");
  });
});
