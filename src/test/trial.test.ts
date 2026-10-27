import { describe, it, expect, beforeEach } from "vitest";
import {
  TRIAL_DAYS, getSubscription, startTrial, trialDaysLeft, canStartTrial,
  hasUsedTrial, requestPayment, confirmPayment, cancelSubscription, isActive,
} from "@/lib/subscriptions";

const H = "tester";

beforeEach(() => localStorage.clear());

describe("7 day free trial", () => {
  it("starts a 7 day trial with no payment", () => {
    const sub = startTrial(H, "pro");
    expect(sub.status).toBe("trial");
    expect(sub.paidAt).toBeNull();
    expect(trialDaysLeft(sub)).toBe(7);
    expect(isActive(sub)).toBe(true);
  });

  it("trial end is exactly 7 days out", () => {
    const sub = startTrial(H, "plus");
    const ms = new Date(sub.trialEndsAt).getTime() - new Date(sub.startedAt).getTime();
    expect(Math.round(ms / 86400000)).toBe(TRIAL_DAYS);
  });

  it("counts down days", () => {
    const sub = startTrial(H, "pro");
    const threeDaysLater = { ...sub, trialEndsAt: new Date(Date.now() + 3 * 86400000).toISOString() };
    localStorage.setItem(`subscription:${H}`, JSON.stringify(threeDaysLater));
    expect(trialDaysLeft(getSubscription(H))).toBe(3);
  });

  it("expires when the clock passes trialEndsAt", () => {
    const sub = startTrial(H, "vip");
    localStorage.setItem(`subscription:${H}`, JSON.stringify({ ...sub, trialEndsAt: new Date(Date.now() - 1000).toISOString() }));
    const got = getSubscription(H);
    expect(got?.status).toBe("expired");
    expect(isActive(got)).toBe(false);
    expect(trialDaysLeft(got)).toBe(0);
  });

  it("only allows one trial per account", () => {
    expect(canStartTrial(H)).toBe(true);
    startTrial(H, "pro");
    expect(hasUsedTrial(H)).toBe(true);
    expect(canStartTrial(H)).toBe(false);
    cancelSubscription(H);
    expect(canStartTrial(H)).toBe(false); // still used
  });

  it("trial -> pending -> active", () => {
    startTrial(H, "pro");
    requestPayment(H, "pro");
    expect(getSubscription(H)?.status).toBe("pending");
    expect(isActive(getSubscription(H))).toBe(false);
    confirmPayment(H);
    const s = getSubscription(H);
    expect(s?.status).toBe("active");
    expect(s?.paidAt).toBeTruthy();
    expect(isActive(s)).toBe(true);
  });

  it("migrates the old bare-string format", () => {
    localStorage.setItem(`subscription:${H}`, "pending:pro");
    expect(getSubscription(H)?.status).toBe("pending");
    localStorage.setItem(`subscription:${H}`, "vip");
    expect(getSubscription(H)?.status).toBe("active");
  });
});
