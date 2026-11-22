import { describe, expect, it } from "vitest";

import {
  CREATOR_SHARE,
  FREE_PREVIEW_SECONDS,
  MAX_PAID_PRICE_CENTS,
  MIN_PAID_PRICE_CENTS,
  PAID_PRICE_OPTIONS,
  coinsForPriceCents,
  creatorShareCents,
  diamondsForPriceCents,
  formatPriceCents,
  isValidPaidPriceCents,
  paidColumns,
  parseCustomPriceCents,
  platformShareCents,
} from "@/lib/paidVideos";

describe("paid video pricing", () => {
  it("offers the four one-tap prices the product asked for", () => {
    expect([...PAID_PRICE_OPTIONS]).toEqual([99, 199, 299, 499]);
    expect(PAID_PRICE_OPTIONS.map(formatPriceCents)).toEqual([
      "$0.99",
      "$1.99",
      "$2.99",
      "$4.99",
    ]);
  });

  it("formats cents as dollars and falls back to Free", () => {
    expect(formatPriceCents(99)).toBe("$0.99");
    expect(formatPriceCents(100)).toBe("$1.00");
    expect(formatPriceCents(4999)).toBe("$49.99");
    expect(formatPriceCents(0)).toBe("Free");
    expect(formatPriceCents(null)).toBe("Free");
    expect(formatPriceCents(undefined)).toBe("Free");
    expect(formatPriceCents(Number.NaN)).toBe("Free");
  });

  it("parses a custom price, tolerating a leading $ and stray text", () => {
    expect(parseCustomPriceCents("1.50")).toBe(150);
    expect(parseCustomPriceCents("$2.99")).toBe(299);
    expect(parseCustomPriceCents(" 12 ")).toBe(1200);
    expect(parseCustomPriceCents("0.99")).toBe(99);
    expect(parseCustomPriceCents("")).toBeNull();
    expect(parseCustomPriceCents("abc")).toBeNull();
    expect(parseCustomPriceCents("1.234")).toBeNull();
  });

  it("rejects custom prices outside the range the database allows", () => {
    expect(MIN_PAID_PRICE_CENTS).toBe(50);
    expect(MAX_PAID_PRICE_CENTS).toBe(100_000);
    expect(parseCustomPriceCents("0.10")).toBeNull();
    expect(parseCustomPriceCents("5000")).toBeNull();
    expect(parseCustomPriceCents("0.50")).toBe(MIN_PAID_PRICE_CENTS);
    expect(parseCustomPriceCents("1000")).toBe(MAX_PAID_PRICE_CENTS);
    expect(isValidPaidPriceCents(49)).toBe(false);
    expect(isValidPaidPriceCents(50)).toBe(true);
    expect(isValidPaidPriceCents(100_000)).toBe(true);
    expect(isValidPaidPriceCents(100_001)).toBe(false);
    expect(isValidPaidPriceCents(null)).toBe(false);
  });
});

describe("paid video revenue split", () => {
  it("gives the creator 80% and Coolerup the remaining 20%", () => {
    expect(CREATOR_SHARE).toBe(0.8);
    for (const cents of [99, 199, 299, 499, 1000, 12_345]) {
      const creator = creatorShareCents(cents);
      const platform = platformShareCents(cents);
      expect(creator + platform).toBe(cents);
      expect(creator).toBe(Math.floor(cents * 0.8));
      expect(platform).toBe(cents - creator);
    }
  });

  it("never loses or invents a cent on odd amounts", () => {
    expect(creatorShareCents(1)).toBe(0);
    expect(platformShareCents(1)).toBe(1);
    expect(creatorShareCents(99)).toBe(79);
    expect(platformShareCents(99)).toBe(20);
  });
});

describe("paid video coin pricing", () => {
  it("treats one coin as half a cent, rounding up", () => {
    expect(coinsForPriceCents(99)).toBe(198);
    expect(coinsForPriceCents(199)).toBe(398);
    expect(coinsForPriceCents(299)).toBe(598);
    expect(coinsForPriceCents(499)).toBe(998);
    expect(coinsForPriceCents(1)).toBe(2);
    expect(coinsForPriceCents(0)).toBe(0);
  });

  it("pays the creator in diamonds at 1 diamond = 1 cent of their 80%", () => {
    expect(diamondsForPriceCents(99)).toBe(79);
    expect(diamondsForPriceCents(499)).toBe(399);
    expect(diamondsForPriceCents(1000)).toBe(800);
  });
});

describe("paid video playback", () => {
  it("shows ten free seconds before the lock", () => {
    expect(FREE_PREVIEW_SECONDS).toBe(10);
  });
});

describe("paidColumns", () => {
  it("writes nothing for a free upload", () => {
    expect(paidColumns(false, null)).toEqual({});
    expect(paidColumns(false, 499)).toEqual({});
  });

  it("writes both columns for a paid upload", () => {
    expect(paidColumns(true, 299)).toEqual({ is_paid: true, price_cents: 299 });
  });

  it("refuses to write a paid row without a valid price", () => {
    expect(() => paidColumns(true, null)).toThrow();
    expect(() => paidColumns(true, 10)).toThrow();
  });
});
