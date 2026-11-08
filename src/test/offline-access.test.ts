import { beforeEach, describe, expect, it } from "vitest";
import {
  hasOfflineAccess,
  offlineLockReason,
  cancelSubscription,
  confirmPayment,
  requestPayment,
  updatePaymentMethod,
  type PaymentMethod,
} from "@/lib/subscriptions";
import { PLANS, planIncludesOffline } from "@/lib/plans";

/**
 * Offline mode is free for everyone. These tests pin that down so a future
 * refactor can't quietly put downloads back behind a paywall.
 */

const H = "offline-tester";

const CARD: PaymentMethod = {
  provider: "card",
  brand: "visa",
  last4: "4242",
  expMonth: 9,
  expYear: 2032,
  holder: "Test User",
  addedAt: new Date().toISOString(),
};

beforeEach(() => {
  localStorage.clear();
});

/** Subscribe for real — there is no free trial, so perks need a paid plan. */
function subscribe(planId = "plus") {
  requestPayment(H, planId);
  updatePaymentMethod(H, CARD);
  confirmPayment(H);
}

describe("planIncludesOffline", () => {
  it("is free for every plan", () => {
    expect(planIncludesOffline("plus")).toBe(true);
    expect(planIncludesOffline("pro")).toBe(true);
    expect(planIncludesOffline("vip")).toBe(true);
  });

  it("is free even with no plan at all", () => {
    expect(planIncludesOffline("free")).toBe(true);
    expect(planIncludesOffline(undefined)).toBe(true);
    expect(planIncludesOffline(null)).toBe(true);
  });

  it("does not sell offline downloads as a plan perk", () => {
    for (const plan of PLANS) {
      expect(plan.perks).not.toContain("Offline downloads");
    }
  });
});

describe("hasOfflineAccess", () => {
  it("is free for a signed-out visitor", () => {
    expect(hasOfflineAccess(null)).toBe(true);
    expect(hasOfflineAccess(undefined)).toBe(true);
    expect(offlineLockReason(null)).toBeNull();
  });

  it("is free for a signed-in user with no plan", () => {
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("stays free on an active paid subscription", () => {
    subscribe("plus");
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("stays free while a payment is still pending", () => {
    requestPayment(H, "plus");
    updatePaymentMethod(H, CARD);
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("stays free when the subscription is cancelled", () => {
    subscribe("plus");
    cancelSubscription(H);
    expect(hasOfflineAccess(H)).toBe(true);
  });

  it("stays free on a legacy trial record", () => {
    localStorage.setItem(
      `subscription:${H}`,
      JSON.stringify({
        planId: "plus",
        status: "trial",
        startedAt: new Date().toISOString(),
        trialEndsAt: new Date(Date.now() + 5 * 86400000).toISOString(),
        paidAt: null,
        paymentMethod: CARD,
      }),
    );
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });
});

describe("pricing", () => {
  it("charges a positive monthly price for every plan", () => {
    for (const plan of PLANS) {
      expect(plan.price).toBeGreaterThan(0);
    }
  });

  it("keeps the tiers ordered cheapest to most expensive", () => {
    const plus = PLANS.find((p) => p.id === "plus")!;
    const pro = PLANS.find((p) => p.id === "pro")!;
    const vip = PLANS.find((p) => p.id === "vip")!;
    expect(plus.price).toBeLessThan(pro.price);
    expect(pro.price).toBeLessThan(vip.price);
  });

  it("prices Plus at 7.99, Pro at 14.99 and VIP at 29.99", () => {
    expect(PLANS.find((p) => p.id === "plus")!.price).toBe(7.99);
    expect(PLANS.find((p) => p.id === "pro")!.price).toBe(14.99);
    expect(PLANS.find((p) => p.id === "vip")!.price).toBe(29.99);
  });
});
