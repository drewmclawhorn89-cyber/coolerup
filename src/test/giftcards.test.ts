import { describe, expect, it } from "vitest";
import {
  GIFT_CARDS,
  GIFT_CARD_FEE_CENTS,
  formatUsd,
  giftCardById,
  giftCardPriceCents,
  isAllowedAmount,
  isEmail,
  maskCode,
} from "@/lib/giftcards";

/**
 * The shop sells real gift cards, so the catalogue is the price list. These
 * tests pin the rules the server relies on when it charges a card.
 */

describe("gift card catalogue", () => {
  it("has unique ids and at least one denomination per card", () => {
    const ids = GIFT_CARDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    GIFT_CARDS.forEach((card) => {
      expect(card.amounts.length).toBeGreaterThan(0);
      expect(card.providerProductId).toBeTruthy();
      expect(card.name).toBeTruthy();
    });
  });

  it("only lists whole-dollar denominations", () => {
    GIFT_CARDS.forEach((card) => {
      card.amounts.forEach((amount) => {
        expect(Number.isInteger(amount)).toBe(true);
        expect(amount).toBeGreaterThan(0);
      });
    });
  });

  it("looks cards up by id", () => {
    expect(giftCardById("amazon")?.name).toBe("Amazon");
    expect(giftCardById("not-a-card")).toBeUndefined();
  });
});

describe("giftCardPriceCents", () => {
  it("charges face value plus the flat fee", () => {
    expect(giftCardPriceCents("amazon", 25)).toBe(2500 + GIFT_CARD_FEE_CENTS);
    expect(giftCardPriceCents("steam", 100)).toBe(10000 + GIFT_CARD_FEE_CENTS);
  });

  it("rejects amounts the retailer does not sell", () => {
    // Steam sells 20/50/100 — not 25.
    expect(giftCardPriceCents("steam", 25)).toBeNull();
    expect(giftCardPriceCents("amazon", 0)).toBeNull();
    expect(giftCardPriceCents("amazon", 12.5)).toBeNull();
    expect(giftCardPriceCents("amazon", -25)).toBeNull();
  });

  it("rejects unknown cards", () => {
    expect(giftCardPriceCents("made-up", 25)).toBeNull();
  });

  it("never returns a price lower than face value", () => {
    GIFT_CARDS.forEach((card) => {
      card.amounts.forEach((amount) => {
        const cents = giftCardPriceCents(card.id, amount);
        expect(cents).not.toBeNull();
        expect(cents!).toBeGreaterThanOrEqual(amount * 100);
      });
    });
  });
});

describe("isAllowedAmount", () => {
  it("matches the catalogue", () => {
    const amazon = giftCardById("amazon")!;
    expect(isAllowedAmount(amazon, 25)).toBe(true);
    expect(isAllowedAmount(amazon, 30)).toBe(false);
  });
});

describe("helpers", () => {
  it("formats cents as dollars", () => {
    expect(formatUsd(2500)).toBe("$25.00");
    expect(formatUsd(1999)).toBe("$19.99");
  });

  it("validates delivery emails", () => {
    expect(isEmail("drew@example.com")).toBe(true);
    expect(isEmail("drew@example")).toBe(false);
    expect(isEmail("not-an-email")).toBe(false);
    expect(isEmail("")).toBe(false);
  });

  it("masks codes without hiding short ones", () => {
    expect(maskCode("ABCD1234EFGH")).toBe("ABCD••••EFGH");
    expect(maskCode("ABC123")).toBe("ABC123");
  });
});
