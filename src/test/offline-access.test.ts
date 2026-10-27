import { beforeEach, describe, expect, it } from "vitest";
import {
  hasOfflineAccess,
  offlineLockReason,
  startTrial,
  cancelSubscription,
  confirmPayment,
  requestPayment,
  type PaymentMethod,
} from "@/lib/subscriptions";
import { PLANS, offlinePlan, planIncludesOffline } from "@/lib/plans";

/**
 * Offline mode is a paid perk: it starts with Plus ($4.99) and every higher
 * tier inherits it. These tests pin the gate down so a future refactor can't
 * quietly hand offline downloads to free accounts.
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

describe("planIncludesOffline", () => {
  it("unlocks offline for Plus, Pro and VIP", () => {
    expect(planIncludesOffline("plus")).toBe(true);
    expect(planIncludesOffline("pro")).toBe(true);
    expect(planIncludesOffline("vip")).toBe(true);
  });

  it("does not unlock offline for unknown or missing plans", () => {
    expect(planIncludesOffline("free")).toBe(false);
    expect(planIncludesOffline(undefined)).toBe(false);
    expect(planIncludesOffline(null)).toBe(false);
  });

  it("advertises offline downloads on the $4.99 Plus plan", () => {
    const plus = PLANS.find((p) => p.id === "plus")!;
    expect(plus.price).toBe(4.99);
    expect(plus.perks).toContain("Offline downloads");
  });

  it("points upgrade prompts at the cheapest offline plan", () => {
    expect(offlinePlan().id).toBe("plus");
    expect(offlinePlan().price).toBe(4.99);
  });
});

describe("hasOfflineAccess", () => {
  it("locks a signed-out visitor", () => {
    expect(hasOfflineAccess(null)).toBe(false);
    expect(hasOfflineAccess(undefined)).toBe(false);
    expect(offlineLockReason(null)).toBe("signed-out");
  });

  it("locks a signed-in user with no plan", () => {
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("no-plan");
  });

  it("unlocks during the free trial, since Plus includes offline", () => {
    startTrial(H, "plus", CARD);
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("unlocks on an active paid subscription", () => {
    startTrial(H, "plus", CARD);
    requestPayment(H, "plus");
    confirmPayment(H);
    expect(hasOfflineAccess(H)).toBe(true);
  });

  it("locks while a payment is still pending", () => {
    startTrial(H, "plus", CARD);
    requestPayment(H, "plus");
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("expired");
  });

  it("locks again when the subscription is cancelled", () => {
    startTrial(H, "plus", CARD);
    expect(hasOfflineAccess(H)).toBe(true);
    cancelSubscription(H);
    expect(hasOfflineAccess(H)).toBe(false);
  });

  it("locks once the trial has run out", () => {
    const sub = startTrial(H, "plus", CARD);
    // Fast-forward past the trial end.
    const lapsed = { ...sub, trialEndsAt: new Date(Date.now() - 1000).toISOString() };
    localStorage.setItem(`subscription:${H}`, JSON.stringify(lapsed));
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("expired");
  });
});
