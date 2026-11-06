import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHRISTMAS_END,
  CHRISTMAS_GIFTS,
  CHRISTMAS_SOUNDS,
  CHRISTMAS_START,
  christmasSoundUrl,
  daysUntilChristmas,
  getChristmasGift,
  isChristmasMode,
} from "@/lib/christmas";

describe("isChristmasMode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const at = (iso: string) => {
    vi.setSystemTime(new Date(iso));
    return isChristmasMode();
  };

  it("is OFF on Nov 1 2026 (today)", () => {
    expect(at("2026-11-01T12:00:00")).toBe(false);
  });

  it("is OFF one second before the window opens", () => {
    expect(at("2026-11-14T23:59:59")).toBe(false);
  });

  it("is ON exactly at Nov 6 2026 02:40", () => {
    expect(at("2026-11-6T00:00:00")).toBe(true);
  });

  it("is ON on Christmas Day", () => {
    expect(at("2026-12-25T09:30:00")).toBe(true);
  });

  it("is ON through the last second of Jan 1 2027", () => {
    expect(at("2027-01-01T23:59:59")).toBe(true);
  });

  it("is OFF on Jan 2 2027", () => {
    expect(at("2027-01-02T00:00:00")).toBe(false);
  });

  it("is OFF in the middle of summer", () => {
    expect(at("2027-07-04T12:00:00")).toBe(false);
  });

  it("uses the documented window bounds", () => {
    expect(CHRISTMAS_START.getFullYear()).toBe(2026);
    expect(CHRISTMAS_START.getMonth()).toBe(10); // November
    expect(CHRISTMAS_START.getDate()).toBe(15);
    expect(CHRISTMAS_END.getFullYear()).toBe(2027);
    expect(CHRISTMAS_END.getMonth()).toBe(0); // January
    expect(CHRISTMAS_END.getDate()).toBe(1);
  });
});

describe("daysUntilChristmas", () => {
  it("counts whole days from Nov 1 2026 to Nov 15 2026", () => {
    expect(daysUntilChristmas(new Date("2026-11-01T00:00:00"))).toBe(14);
  });

  it("returns 0 once the update is live", () => {
    expect(daysUntilChristmas(new Date("2026-12-25T00:00:00"))).toBe(0);
  });
});

describe("Christmas catalogue", () => {
  it("ships ten Christmas sounds, all titled 'Christmas - ...' by @coolerup", () => {
    expect(CHRISTMAS_SOUNDS).toHaveLength(10);
    for (const sound of CHRISTMAS_SOUNDS) {
      expect(sound.title.startsWith("Christmas - ")).toBe(true);
      expect(sound.creator).toBe("coolerup");
      expect(christmasSoundUrl(sound.slug)).toBe(`/sounds/christmas/${sound.slug}.mp3`);
    }
    expect(new Set(CHRISTMAS_SOUNDS.map((s) => s.slug)).size).toBe(10);
  });

  it("has a gift catalogue with unique ids", () => {
    expect(CHRISTMAS_GIFTS.length).toBeGreaterThan(0);
    expect(new Set(CHRISTMAS_GIFTS.map((g) => g.id)).size).toBe(CHRISTMAS_GIFTS.length);
    expect(getChristmasGift("gift-box")?.emoji).toBe("🎁");
    expect(getChristmasGift("nope")).toBeNull();
  });
});
