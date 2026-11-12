import { beforeEach, describe, expect, it } from "vitest";

import {
  backgroundPlayLockReason,
  cancelSubscription,
  confirmPayment,
  hasBackgroundPlayAccess,
  planUnlocksBackgroundPlay,
  requestPayment,
  updatePaymentMethod,
  type PaymentMethod,
} from "@/lib/subscriptions";
import { backgroundPlayPlan, PLANS, planIncludesBackgroundPlay } from "@/lib/plans";

/**
 * Background play is a VIP-only perk. These tests pin that down so a future
 * refactor cannot quietly hand it to Plus or Pro (which keep offline *video*
 * downloads) or leave it unlocked after a downgrade.
 */

const H = "bg-tester";

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

function subscribe(planId = "vip") {
  requestPayment(H, planId);
  updatePaymentMethod(H, CARD);
  confirmPayment(H);
}

describe("planIncludesBackgroundPlay", () => {
  it("is VIP-only", () => {
    expect(planIncludesBackgroundPlay("vip")).toBe(true);
    expect(planIncludesBackgroundPlay("plus")).toBe(false);
    expect(planIncludesBackgroundPlay("pro")).toBe(false);
    expect(planIncludesBackgroundPlay("free")).toBe(false);
    expect(planIncludesBackgroundPlay(undefined)).toBe(false);
  });

  it("is included in the lifetime all-access plan", () => {
    expect(planIncludesBackgroundPlay("all")).toBe(true);
  });

  it("is advertised on the VIP plan and not below it", () => {
    expect(PLANS.filter((p) => p.backgroundPlay).map((p) => p.id)).toEqual(["vip"]);
    expect(PLANS.find((p) => p.id === "vip")!.perks).toContain("Background play");
  });

  it("points the upsell at VIP", () => {
    expect(backgroundPlayPlan().id).toBe("vip");
    expect(backgroundPlayPlan().backgroundPlay).toBe(true);
  });
});

describe("hasBackgroundPlayAccess", () => {
  it("is locked for a signed-out visitor", () => {
    expect(hasBackgroundPlayAccess(null)).toBe(false);
    expect(hasBackgroundPlayAccess(undefined)).toBe(false);
    expect(backgroundPlayLockReason(null)).toBe("signed-out");
  });

  it("is locked for a signed-in user with no plan", () => {
    expect(hasBackgroundPlayAccess(H)).toBe(false);
    expect(backgroundPlayLockReason(H)).toBe("no-plan");
  });

  it("is locked on active Plus and Pro subscriptions", () => {
    subscribe("plus");
    expect(hasBackgroundPlayAccess(H)).toBe(false);
    expect(planUnlocksBackgroundPlay(H)).toBe(false);
    expect(backgroundPlayLockReason(H)).toBe("plan-lacks-offline");

    subscribe("pro");
    expect(hasBackgroundPlayAccess(H)).toBe(false);
    expect(planUnlocksBackgroundPlay(H)).toBe(false);
  });

  it("unlocks on an active VIP subscription", () => {
    subscribe("vip");
    expect(hasBackgroundPlayAccess(H)).toBe(true);
    expect(planUnlocksBackgroundPlay(H)).toBe(true);
    expect(backgroundPlayLockReason(H)).toBeNull();
  });

  it("stays locked while a VIP payment is pending", () => {
    requestPayment(H, "vip");
    updatePaymentMethod(H, CARD);
    expect(hasBackgroundPlayAccess(H)).toBe(false);
    expect(backgroundPlayLockReason(H)).toBe("expired");
  });

  it("locks again once the VIP subscription is cancelled", () => {
    subscribe("vip");
    cancelSubscription(H);
    expect(hasBackgroundPlayAccess(H)).toBe(false);
    expect(backgroundPlayLockReason(H)).toBe("no-plan");
  });
});
