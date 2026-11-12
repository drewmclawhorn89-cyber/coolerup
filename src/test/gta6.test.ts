import { describe, expect, it } from "vitest";

import {
  GTA6_END,
  GTA6_END_ISO,
  GTA6_START,
  GTA6_START_ISO,
  formatGTA6Countdown,
  gta6TestAllowed,
  gta6TimeLeft,
  isGTA6Ended,
  isGTA6Mode,
  isGTA6Upcoming,
} from "@/lib/gta6";
import { CAMERA_FILTERS, GTA6_CAMERA_FILTER, filterById, filtersForMode } from "@/lib/filters";
import { giftsForMode } from "@/lib/coins";

const at = (iso: string) => new Date(iso);

describe("GTA 6 event window", () => {
  it("starts at Nov 8 2026 00:00 and ends Nov 15 2026 23:59:59", () => {
    expect(GTA6_START_ISO).toBe("2026-11-08T00:00:00");
    expect(GTA6_END_ISO).toBe("2026-11-15T23:59:59");
    expect(GTA6_START.getTime()).toBeLessThan(GTA6_END.getTime());
  });

  it("is off one second before the start", () => {
    expect(isGTA6Mode(at("2026-11-07T23:59:59"))).toBe(false);
    expect(isGTA6Upcoming(at("2026-11-07T23:59:59"))).toBe(true);
  });

  it("is on at the exact start", () => {
    expect(isGTA6Mode(at("2026-11-08T00:00:00"))).toBe(true);
    expect(isGTA6Upcoming(at("2026-11-08T00:00:00"))).toBe(false);
  });

  it("is on in the middle of the window", () => {
    expect(isGTA6Mode(at("2026-11-11T12:00:00"))).toBe(true);
    expect(isGTA6Ended(at("2026-11-11T12:00:00"))).toBe(false);
  });

  it("is still on at the last second", () => {
    expect(isGTA6Mode(at("2026-11-15T23:59:59"))).toBe(true);
    expect(isGTA6Ended(at("2026-11-15T23:59:59"))).toBe(false);
  });

  it("is off one second after the end, and stays off forever", () => {
    expect(isGTA6Mode(at("2026-11-16T00:00:00"))).toBe(false);
    expect(isGTA6Ended(at("2026-11-16T00:00:00"))).toBe(true);
    expect(isGTA6Mode(at("2027-11-10T12:00:00"))).toBe(false);
    expect(isGTA6Ended(at("2030-11-10T12:00:00"))).toBe(true);
  });

  it("never allows the test param after the event ends", () => {
    expect(gta6TestAllowed(at("2026-11-07T12:00:00"))).toBe(true);
    expect(gta6TestAllowed(at("2026-11-10T12:00:00"))).toBe(true);
    expect(gta6TestAllowed(at("2026-11-16T00:00:00"))).toBe(false);
    expect(gta6TestAllowed(at("2027-01-01T00:00:00"))).toBe(false);
  });
});

describe("countdown", () => {
  it("counts down to Nov 15 23:59:59", () => {
    const left = gta6TimeLeft(at("2026-11-09T11:29:59"));
    expect(left.days).toBe(6);
    expect(left.hours).toBe(12);
    expect(left.minutes).toBe(30);
    expect(left.ended).toBe(false);
  });

  it("never goes negative", () => {
    const left = gta6TimeLeft(at("2026-12-01T00:00:00"));
    expect(left.ms).toBe(0);
    expect(left.days).toBe(0);
    expect(left.ended).toBe(true);
  });

  it("formats days/hours/minutes and short forms", () => {
    expect(formatGTA6Countdown(at("2026-11-09T11:29:59"))).toBe("6 days 12h 30m left");
    expect(formatGTA6Countdown(at("2026-11-15T11:29:59"))).toBe("12h 30m 0s left");
    expect(formatGTA6Countdown(at("2026-11-16T00:00:00"))).toBe("Event ended");
  });
});

describe("GTA 6 filter", () => {
  it("is only offered in GTA 6 mode", () => {
    expect(filtersForMode(false)).toEqual(CAMERA_FILTERS);
    expect(filtersForMode(true)).toEqual([...CAMERA_FILTERS, GTA6_CAMERA_FILTER]);
    expect(filtersForMode(true).some((f) => f.id === "gta6")).toBe(true);
  });

  it("resolves by id in both modes", () => {
    expect(filterById("gta6", true).id).toBe("gta6");
    expect(filterById("gta6", false).id).toBe(CAMERA_FILTERS[0]!.id);
  });
});

describe("GTA 6 gift", () => {
  it("only exists during the event", () => {
    expect(giftsForMode(false, false).some((g) => g.id === "gta-car")).toBe(false);
    expect(giftsForMode(false, true).some((g) => g.id === "gta-car")).toBe(true);
    // and it is gone again once the event is over
    expect(giftsForMode(true, false).some((g) => g.id === "gta-car")).toBe(false);
  });

  it("costs 100 coins and is named GTA Car", () => {
    const car = giftsForMode(false, true).find((g) => g.id === "gta-car");
    expect(car?.coins).toBe(100);
    expect(car?.name).toBe("GTA Car");
  });
});
