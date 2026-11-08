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
import { PLANS, offlinePlan, planIncludesOffline } from "@/lib/plans";

/**
 * Offline mode ships with Pro and VIP, but deliberately not with Plus.
 * These tests pin that split down so a future refactor can't quietly move
 * downloads into Plus or give them away for free.
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
function subscribe(planId = "pro") {
  requestPayment(H, planId);
  updatePaymentMethod(H, CARD);
  confirmPayment(H);
}

describe("planIncludesOffline", () => {
  it("is included in Pro and VIP", () => {
    expect(planIncludesOffline("pro")).toBe(true);
    expect(planIncludesOffline("vip")).toBe(true);
  });

  it("is not included in Plus", () => {
    expect(planIncludesOffline("plus")).toBe(false);
  });

  it("is not included for free or unknown plans", () => {
    expect(planIncludesOffline("free")).toBe(false);
    expect(planIncludesOffline(undefined)).toBe(false);
    expect(planIncludesOffline(null)).toBe(false);
  });

  it("advertises offline downloads on Pro and VIP only", () => {
    const withOffline = PLANS.filter((p) => p.perks.includes("Offline downloads")).map((p) => p.id);
    expect(withOffline).toEqual(["pro", "vip"]);
  });
});

describe("offlinePlan", () => {
  it("points the upsell at Pro, the cheapest plan with offline", () => {
    expect(offlinePlan().id).toBe("pro");
    expect(offlinePlan().offline).toBe(true);
  });
});

describe("hasOfflineAccess", () => {
  it("is locked for a signed-out visitor", () => {
    expect(hasOfflineAccess(null)).toBe(false);
    expect(hasOfflineAccess(undefined)).toBe(false);
    expect(offlineLockReason(null)).toBe("signed-out");
  });

  it("is locked for a signed-in user with no plan", () => {
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("no-plan");
  });

  it("is locked on an active Plus subscription", () => {
    subscribe("plus");
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("plan-lacks-offline");
  });

  it("unlocks on an active Pro subscription", () => {
    subscribe("pro");
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("unlocks on an active VIP subscription", () => {
    subscribe("vip");
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("is locked while a payment is still pending", () => {
    requestPayment(H, "pro");
    updatePaymentMethod(H, CARD);
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("expired");
  });

  it("is locked again once the subscription is cancelled", () => {
    subscribe("pro");
    cancelSubscription(H);
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("no-plan");
  });

  it("is locked on a legacy trial record", () => {
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
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("expired");
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
