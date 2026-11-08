import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRIAL_MS,
  formatTrialRemaining,
  getTrial,
  hasUsedTrial,
  isTrialActive,
  startTrial,
  trialRemainingMs,
} from "@/lib/trial";
import { hasOfflineAccess, offlineLockReason } from "@/lib/subscriptions";

/**
 * Offline mode is a Pro/VIP perk, but every account gets one free hour first.
 * These tests pin the length, the one-shot rule and the way the hour feeds the
 * offline gate.
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
    const trial = startTrial(H)!;
    expect(trial.startedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(trial.endsAt).toBe("2026-01-01T01:00:00.000Z");
    expect(trialRemainingMs(H)).toBe(TRIAL_MS);
  });
});

describe("starting the trial", () => {
  it("does nothing for a signed-out visitor", () => {
    expect(startTrial(null)).toBeNull();
    expect(startTrial(undefined)).toBeNull();
    expect(hasUsedTrial(null)).toBe(false);
  });

  it("records the trial for the account", () => {
    expect(hasUsedTrial(H)).toBe(false);
    startTrial(H);
    expect(hasUsedTrial(H)).toBe(true);
    expect(getTrial(H)?.endsAt).toBeTruthy();
  });

  it("never hands out a second hour", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const first = startTrial(H)!;
    // Two hours later they come back for more.
    vi.setSystemTime(new Date("2026-01-01T02:00:00.000Z"));
    const again = startTrial(H)!;
    expect(again.startedAt).toBe(first.startedAt);
    expect(again.endsAt).toBe(first.endsAt);
    expect(isTrialActive(H)).toBe(false);
  });

  it("keeps each account's trial separate", () => {
    startTrial(H);
    expect(hasUsedTrial(H)).toBe(true);
    expect(hasUsedTrial("someone-else")).toBe(false);
  });
});

describe("expiry", () => {
  it("is active for the first 59 minutes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H);
    vi.setSystemTime(new Date("2026-01-01T00:59:00.000Z"));
    expect(isTrialActive(H)).toBe(true);
    expect(trialRemainingMs(H)).toBe(60 * 1000);
  });

  it("is over at the hour mark", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H);
    vi.setSystemTime(new Date("2026-01-01T01:00:00.000Z"));
    expect(isTrialActive(H)).toBe(false);
    expect(trialRemainingMs(H)).toBe(0);
    expect(hasUsedTrial(H)).toBe(true);
  });

  it("never reports negative time left", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H);
    vi.setSystemTime(new Date("2026-01-05T00:00:00.000Z"));
    expect(trialRemainingMs(H)).toBe(0);
  });

  it("ignores a corrupt record", () => {
    localStorage.setItem(`trial:${H}`, "not json");
    expect(getTrial(H)).toBeNull();
    expect(isTrialActive(H)).toBe(false);
    expect(hasUsedTrial(H)).toBe(false);
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

describe("the trial unlocks offline mode", () => {
  it("unlocks saving for a signed-in viewer with no plan", () => {
    expect(hasOfflineAccess(H)).toBe(false);
    startTrial(H);
    expect(hasOfflineAccess(H)).toBe(true);
    expect(offlineLockReason(H)).toBeNull();
  });

  it("locks again once the hour is up", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    startTrial(H);
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
