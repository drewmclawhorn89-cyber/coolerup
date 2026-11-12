import { describe, expect, it } from "vitest";

import {
  gta6ClaimErrorMessage,
  gta6ProgressLabel,
  gta6ProgressPercent,
  gta6Remaining,
  withGTA6Hashtag,
  GTA6_CHALLENGE_CODE,
  GTA6_CHALLENGE_MONTHS,
  GTA6_CHALLENGE_PLAN_ID,
  GTA6_CHALLENGE_REQUIRED,
  GTA6_CHALLENGE_REWARD_LABEL,
} from "@/lib/gta6-challenge";
import { GTA6_HASHTAG } from "@/lib/gta6";

describe("GTA 6 challenge constants", () => {
  it("requires 10 videos and grants one month of Pro", () => {
    expect(GTA6_CHALLENGE_REQUIRED).toBe(10);
    expect(GTA6_CHALLENGE_PLAN_ID).toBe("pro");
    expect(GTA6_CHALLENGE_MONTHS).toBe(1);
    expect(GTA6_CHALLENGE_REWARD_LABEL).toBe("1 month of Pro free");
    expect(GTA6_CHALLENGE_CODE).toBe("GTA6-CHALLENGE");
  });
});

describe("gta6ProgressPercent", () => {
  it("scales 0-10 onto 0-100", () => {
    expect(gta6ProgressPercent(0)).toBe(0);
    expect(gta6ProgressPercent(5)).toBe(50);
    expect(gta6ProgressPercent(10)).toBe(100);
  });

  it("clamps above the target and below zero", () => {
    expect(gta6ProgressPercent(14)).toBe(100);
    expect(gta6ProgressPercent(-3)).toBe(0);
  });

  it("never divides by zero", () => {
    expect(gta6ProgressPercent(4, 0)).toBe(0);
  });
});

describe("gta6ProgressLabel", () => {
  it("reads as a score out of the requirement", () => {
    expect(gta6ProgressLabel(7)).toBe("7 / 10 GTA videos");
    expect(gta6ProgressLabel(0)).toBe("0 / 10 GTA videos");
  });

  it("does not overshoot the requirement", () => {
    expect(gta6ProgressLabel(15)).toBe("10 / 10 GTA videos");
  });
});

describe("gta6Remaining", () => {
  it("counts down to zero", () => {
    expect(gta6Remaining(0)).toBe(10);
    expect(gta6Remaining(9)).toBe(1);
    expect(gta6Remaining(10)).toBe(0);
  });

  it("stays at zero once the target is passed", () => {
    expect(gta6Remaining(12)).toBe(0);
  });
});

describe("withGTA6Hashtag", () => {
  it("appends the hashtag when it is missing", () => {
    expect(withGTA6Hashtag("vice city vibes")).toBe(`vice city vibes ${GTA6_HASHTAG}`);
  });

  it("uses the hashtag alone for an empty caption", () => {
    expect(withGTA6Hashtag("   ")).toBe(GTA6_HASHTAG);
  });

  it("does not duplicate the hashtag, whatever the case", () => {
    expect(withGTA6Hashtag(`already ${GTA6_HASHTAG}`)).toBe(`already ${GTA6_HASHTAG}`);
    expect(withGTA6Hashtag("already #gta6coolerup")).toBe("already #gta6coolerup");
    expect(withGTA6Hashtag("#GTA6COOLERUP")).toBe("#GTA6COOLERUP");
  });

  it("keeps the caption inside the 500 character upload limit", () => {
    const long = "x".repeat(495);
    const out = withGTA6Hashtag(long);
    expect(out.length).toBe(500);
    expect(out.endsWith(GTA6_HASHTAG)).toBe(true);
  });
});

describe("gta6ClaimErrorMessage", () => {
  it("explains every failure the RPC can return", () => {
    expect(gta6ClaimErrorMessage("not_enough_videos")).toMatch(/more GTA 6 videos/i);
    expect(gta6ClaimErrorMessage("already_claimed")).toMatch(/already claimed/i);
    expect(gta6ClaimErrorMessage("ended")).toMatch(/has ended/i);
    expect(gta6ClaimErrorMessage("not_signed_in")).toMatch(/sign in/i);
    expect(gta6ClaimErrorMessage("unknown")).toMatch(/try again/i);
  });
});
