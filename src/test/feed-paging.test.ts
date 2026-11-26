import { describe, expect, it } from "vitest";
import {
  FEED_BATCH_SIZE,
  PRELOAD_AHEAD,
  hasMoreToShow,
  nextVisibleCount,
  preloadModeFor,
} from "@/lib/feedPaging";

describe("10-at-a-time feed paging", () => {
  it("reveals 10 more each time and clamps to the total", () => {
    expect(FEED_BATCH_SIZE).toBe(10);
    expect(nextVisibleCount(10, 35)).toBe(20);
    expect(nextVisibleCount(20, 35)).toBe(30);
    expect(nextVisibleCount(30, 35)).toBe(35);
    expect(nextVisibleCount(35, 35)).toBe(35);
  });

  it("reports whether hidden rows remain", () => {
    expect(hasMoreToShow(10, 11)).toBe(true);
    expect(hasMoreToShow(10, 10)).toBe(false);
    expect(hasMoreToShow(0, 0)).toBe(false);
  });
});

describe("preload window", () => {
  it("preloads exactly the next two videos, not the whole list", () => {
    expect(PRELOAD_AHEAD).toBe(2);
    expect(preloadModeFor(5, 5)).toBe("active");
    expect(preloadModeFor(6, 5)).toBe("next");
    expect(preloadModeFor(7, 5)).toBe("next");
    expect(preloadModeFor(8, 5)).toBe("idle");
    expect(preloadModeFor(4, 5)).toBe("idle");
  });

  it("never preloads in lite or low-data mode", () => {
    expect(preloadModeFor(6, 5, { lite: true })).toBe("idle");
    expect(preloadModeFor(6, 5, { lowData: true })).toBe("idle");
    // The on-screen card still plays.
    expect(preloadModeFor(5, 5, { lite: true })).toBe("active");
  });
});
