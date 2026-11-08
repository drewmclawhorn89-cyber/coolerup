import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isChristmasMode } from "@/lib/christmas";
import { isChristmasCodesSeason } from "@/lib/christmas-codes";
import {
  CHRISTMAS_TEST_KEY,
  isChristmasTestMode,
  isChristmasTestOwner,
  setChristmasTestMode,
} from "@/lib/christmas-test";

describe("Christmas test override", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2027-07-04T12:00:00"));
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.useRealTimers();
  });

  it("is off by default and both gates stay closed out of season", () => {
    expect(isChristmasTestMode()).toBe(false);
    expect(isChristmasMode()).toBe(false);
    expect(isChristmasCodesSeason()).toBe(false);
  });

  it("forces the update and the codes tab on in the middle of summer", () => {
    setChristmasTestMode(true);
    expect(isChristmasTestMode()).toBe(true);
    expect(isChristmasMode()).toBe(true);
    expect(isChristmasCodesSeason()).toBe(true);
  });

  it("turns everything back off", () => {
    setChristmasTestMode(true);
    setChristmasTestMode(false);
    expect(isChristmasTestMode()).toBe(false);
    expect(isChristmasMode()).toBe(false);
    expect(isChristmasCodesSeason()).toBe(false);
    expect(window.localStorage.getItem(CHRISTMAS_TEST_KEY)).toBeNull();
  });

  it("only recognises the owner handle", () => {
    expect(isChristmasTestOwner("drewmclawhorn3")).toBe(true);
    expect(isChristmasTestOwner("@DrewMcLawhorn3")).toBe(true);
    expect(isChristmasTestOwner("someone-else")).toBe(false);
    expect(isChristmasTestOwner(null)).toBe(false);
  });
});
