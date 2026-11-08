import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRIAL_MS,
  activeTrial,
  formatTrialRemaining,
  getTrial,
  hasUsedTrial,
  isTrialActive,
  startTrial,
  trialRemainingMs,
} from "@/lib/trial";
import {
  hasOfflineAccess,
  hasPlanAccess,
  offlineLockReason,
  planInForce,
} from "@/lib/subscriptions";

/**
 * Every plan carries its own one-hour free trial. These tests pin the length,
 * the one-shot-per-plan rule, the per-plan isolation and the way each hour
 * feeds the plan and offline gates.
 */

const H = "trial-tester";

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trial length", () => {
  it("is exactly one hour", () => {
    expect(TRIAL_MS).toBe(60 * 60 * 1000);
  });

  it("ends one hour after it starts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const trial = startTrial(H, "pro")!;
    expect(trial.planId).toBe("pro");
    expect(trial.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(trial.endsAt).toBe("2026-01-01T01:00:00.000Z");
    expect(trialRemainingMs(H, "pro")).toBe(TRIAL_MS);
  });
});

describe("starting a trial", () => {
  it("does nothing for a signed-out visitor", () => {
    expect(startTrial(null, "pro")).toBeNull();
    expect(startTrial(undefined, "pro")).toBeNull();
    expect(hasUsedTrial(null, "pro")).toBe(false);
  });

  it("does nothing without a plan", () => {
    expect(startTrial(H)).toBeNull();
    expect(startTrial(H, null)).toBeNull();
    expect(hasUsedTrial(H)).toBe(false);
  });

  it("records the trial against the plan", () => {
    expect(hasUsedTrial(H, "pro")).toBe(false);
    startTrial(H, "pro");
    expect(hasUsedTrial(H, "pro")).toBe(true);
    expect(getTrial(H, "pro")?.endsAt).toBeTruthy();
  });

  it("gives every plan its own hour", () => {
    startTrial(H, "plus");
    expect(hasUsedTrial(H, "plus")).toBe(true);
    // Trying Plus must not burn the Pro or VIP hour.
    expect(hasUsedTrial(H, "pro")).toBe(false);
    expect(hasUsedTrial(H, "vip")).toBe(false);
    startTrial(H, "pro");
    startTrial(H, "vip");
    expect(hasUsedTrial(H, "pro")).toBe(true);
    expect(hasUsedTrial(H, "vip")).toBe(true);
  });

  it("never hands out a second hour on the same plan", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const first = startTrial(H, "pro")!;
    // Two hours later they come back for more.
    vi.setSystemTime(new Date("2026-01-01T02:00:00.000Z"));
    const again = startTrial(H, "pro")!;
    expect(again.startedAt).toBe(first.startedAt);
    expect(again.endsAt).toBe(first.endsAt);
    expect(isTrialActive(H, "pro")).toBe(false);
  });

  it("keeps each account's trial separate", () => {
    startTrial(H, "pro");
    expect(hasUsedTrial(H, "pro")).toBe(true);
    expect(hasUsedTrial("someone-else", "pro")).toBe(false);
  });
});

describe("expiry", () => {
  it("is active for the first 59 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H, "pro");
    vi.setSystemTime(new Date("2026-01-01T00:59:00.000Z"));
    expect(isTrialActive(H, "pro")).toBe(true);
    expect(trialRemainingMs(H, "pro")).toBe(60 * 1000);
  });

  it("is over at the hour mark", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H, "pro");
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    expect(isTrialActive(H, "pro")).toBe(false);
    expect(trialRemainingMs(H, "pro")).toBe(0);
    expect(hasUsedTrial(H, "pro")).toBe(true);
  });

  it("never reports negative time left", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H, "pro");
    vi.setSystemTime(new Date("2026-01-05T00:00:00.000Z"));
    expect(trialRemainingMs(H, "pro")).toBe(0);
  });

  it("ignores a corrupt record", () => {
    localStorage.setItem(`trial:${H}:pro`, "not json");
    expect(getTrial(H, "pro")).toBeNull();
    expect(isTrialActive(H, "pro")).toBe(false);
    expect(hasUsedTrial(H, "pro")).toBe(false);
  });
});

describe("the running trial", () => {
  it("reports whichever hour is live", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H, "plus");
    expect(activeTrial(H)?.planId).toBe("plus");
    vi.setSystemTime(new Date("2026-01-01T00:30:00.000Z"));
    startTrial(H, "vip");
    // VIP ends later, so it is the one in force.
    expect(activeTrial(H)?.planId).toBe("vip");
    expect(trialRemainingMs(H)).toBe(60 * 60 * 1000);
  });

  it("is null once every hour has run out", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H, "plus");
    vi.setSystemTime(new Date("2026-01-01T02:00:00.000Z"));
    expect(activeTrial(H)).toBeNull();
  });
});

describe("legacy records", () => {
  it("migrates the old plan-less hour onto Pro", () => {
    localStorage.setItem(
      `trial:${H}`,
      JSON.stringify({
        startedAt: new Date("2026-01-01T00:00:00.000Z").toISOString(),
        endsAt: new Date("2026-01-01T01:00:00.000Z").toISOString(),
      }),
    );
    expect(getTrial(H, "pro")?.planId).toBe("pro");
    expect(hasUsedTrial(H, "pro")).toBe(true);
    // The old hour was an offline trial, so it does not burn Plus or VIP.
    expect(hasUsedTrial(H, "plus")).toBe(false);
    expect(hasUsedTrial(H, "vip")).toBe(false);
  });
});

describe("countdown label", () => {
  it("formats mm:ss", () => {
    expect(formatTrialRemaining(TRIAL_MS)).toBe("60:00");
    expect(formatTrialRemaining(59 * 60 * 1000 + 59 * 1000)).toBe("59:59");
    expect(formatTrialRemaining(9 * 1000)).toBe("0:09");
    expect(formatTrialRemaining(0)).toBe("0:00");
    expect(formatTrialRemaining(-5000)).toBe("0:00");
  });
});

describe("a trial unlocks its plan", () => {
  it("puts the trialed plan in force", () => {
    expect(planInForce(H)).toBeNull();
    startTrial(H, "vip");
    expect(planInForce(H)).toBe("vip");
    expect(hasPlanAccess(H, "vip")).toBe(true);
    expect(hasPlanAccess(H, "pro")).toBe(false);
  });

  it("stops being in force when the hour ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H, "plus");
    vi.setSystemTime(new Date("2026-01-01T01:00:01.000Z"));
    expect(planInForce(H)).toBeNull();
    expect(hasPlanAccess(H, "plus")).toBe(false);
  });
});

describe("the trial unlocks offline mode", () => {
  it("unlocks saving on a Pro trial for a viewer with no plan", () => {
    expect(hasOfflineAccess(H)).toBe(false);
    startTrial(H, "pro");
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("unlocks saving on a VIP trial", () => {
    startTrial(H, "vip");
    expect(hasOfflineAccess(H)).toBe(true);
  });

  it("does not unlock saving on a Plus trial, because Plus lacks offline", () => {
    startTrial(H, "plus");
    expect(hasOfflineAccess(H)).toBe(false);
    // No paid plan on file, and the Plus hour does not include downloads.
    expect(offlineLockReason(H)).toBe("no-plan");
  });

  it("locks again once the Pro hour is up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H, "pro");
    vi.setSystemTime(new Date("2026-01-01T01:00:01.000Z"));
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("trial-ended");
  });

  it("still reports a Plus plan as lacking offline after the trial", () => {
    localStorage.setItem(
      `subscription:${H}`,
      JSON.stringify({
        planId: "plus",
        status: "active",
        startedAt: new Date().toISOString(),
        paidAt: new Date().toISOString(),
        paymentMethod: null,
      }),
    );
    expect(hasOfflineAccess(H)).toBe(false);
    expect(offlineLockReason(H)).toBe("plan-lacks-offline");
  });

  it("does not give a signed-out visitor a trial", () => {
    expect(hasOfflineAccess(null)).toBe(false);
    expect(offlineLockReason(null)).toBe("signed-out");
  });
});
