import { describe, expect, it } from "vitest";

import {
  animationScale,
  canAfford,
  centsFromDiamonds,
  coinsFromDiamonds,
  coinsPerCent,
  diamondsFromCoins,
  earningsFromCoins,
  giftById,
  giftMessage,
  giftTotal,
  giftsForMode,
  LIVE_GIFTS,
  MIN_CASHOUT_DIAMONDS,
  packById,
  particleCount,
  tickerLine,
  topGifterLine,
  topGifters,
  usdFromCents,
  COIN_PACKS,
  type GiftFeedRow,
} from "@/lib/coins";

const row = (over: Partial<GiftFeedRow> = {}): GiftFeedRow => ({
  id: "g1",
  gift_type: "rose",
  coins: 1,
  quantity: 1,
  sender_id: "u1",
  created_at: "2026-01-01T00:00:00.000Z",
  sender: { username: "john" },
  ...over,
});

describe("gift catalogue", () => {
  it("has the seven core gifts with the right coin costs", () => {
    const costs: Record<string, number> = Object.fromEntries(
      LIVE_GIFTS.map((g) => [g.id, g.coins]),
    );
    expect(costs["rose"]).toBe(1);
    expect(costs["heart"]).toBe(5);
    expect(costs["tiktok"]).toBe(10);
    expect(costs["hat"]).toBe(20);
    expect(costs["christmas"]).toBe(50);
    expect(costs["lion"]).toBe(100);
    expect(costs["universe"]).toBe(500);
  });

  it("keeps the Christmas gift year-round but hides Santa outside Christmas mode", () => {
    expect(giftsForMode(false).some((g) => g.id === "christmas")).toBe(true);
    expect(giftsForMode(false).some((g) => g.id === "santa")).toBe(false);
    expect(giftsForMode(true).some((g) => g.id === "santa")).toBe(true);
  });

  it("looks gifts up by id", () => {
    expect(giftById("lion")?.coins).toBe(100);
    expect(giftById("nope")).toBeUndefined();
  });
});

describe("gift totals and affordability", () => {
  it("multiplies unit cost by quantity", () => {
    expect(giftTotal({ coins: 5 }, 1)).toBe(5);
    expect(giftTotal({ coins: 5 }, 10)).toBe(50);
  });

  it("clamps quantity into 1..100", () => {
    expect(giftTotal({ coins: 5 }, 0)).toBe(5);
    expect(giftTotal({ coins: 5 }, -3)).toBe(5);
    expect(giftTotal({ coins: 5 }, 500)).toBe(500);
  });

  it("only affords when balance covers the cost", () => {
    expect(canAfford(10, 10)).toBe(true);
    expect(canAfford(9, 10)).toBe(false);
    expect(canAfford(null, 1)).toBe(false);
    expect(canAfford(undefined, 1)).toBe(false);
  });
});

describe("gift messages", () => {
  it("formats a single gift", () => {
    expect(giftMessage("drewmclawhorn3", giftById("rose")!, 1)).toBe("drewmclawhorn3 sent Rose 🌹");
  });

  it("formats a x10 gift", () => {
    expect(giftMessage("drewmclawhorn3", giftById("rose")!, 10)).toBe(
      "drewmclawhorn3 sent Rose 🌹 x10",
    );
  });
});

describe("animation sizing", () => {
  it("scales up for bigger bundles", () => {
    expect(animationScale(1, 1)).toBe(1);
    expect(animationScale(5, 5)).toBeGreaterThan(1);
    expect(animationScale(10, 10)).toBeGreaterThan(animationScale(5, 5));
  });

  it("scales up for expensive gifts", () => {
    expect(animationScale(1, 500)).toBeGreaterThan(animationScale(1, 1));
  });

  it("uses a single particle in low-data mode", () => {
    expect(particleCount(10, true)).toBe(1);
    expect(particleCount(10, false)).toBeGreaterThan(1);
    expect(particleCount(1, false)).toBe(1);
  });
});

describe("coins, diamonds and money", () => {
  it("converts 100 coins into 50 diamonds", () => {
    expect(diamondsFromCoins(100)).toBe(50);
    expect(diamondsFromCoins(2500)).toBe(1250);
  });

  it("converts diamonds back to coins", () => {
    expect(coinsFromDiamonds(50)).toBe(100);
  });

  it("prices a diamond at one cent", () => {
    expect(centsFromDiamonds(50)).toBe(50);
    expect(usdFromCents(50)).toBe("$0.50");
    expect(usdFromCents(2500)).toBe("$25.00");
  });

  it("computes streamer earnings from coins", () => {
    expect(earningsFromCoins(2500)).toEqual({ diamonds: 1250, cents: 1250, usd: "$12.50" });
    expect(earningsFromCoins(0)).toEqual({ diamonds: 0, cents: 0, usd: "$0.00" });
  });

  it("requires 500 diamonds to cash out", () => {
    expect(MIN_CASHOUT_DIAMONDS).toBe(500);
  });
});

describe("coin packs", () => {
  it("sells 100/$0.99, 500/$4.99 and 1000/$9.99", () => {
    expect(COIN_PACKS.map((p) => [p.coins, p.cents])).toEqual([
      [100, 99],
      [500, 499],
      [1000, 999],
    ]);
  });

  it("finds a pack by id and compares value", () => {
    expect(packById("coins-500")?.coins).toBe(500);
    expect(packById("nope")).toBeUndefined();
    // Prices are the spec's exact numbers, so the smallest pack has the best rate.
    expect(coinsPerCent(packById("coins-100")!)).toBeGreaterThan(
      coinsPerCent(packById("coins-1000")!),
    );
    expect(coinsPerCent(packById("coins-500")!)).toBeGreaterThan(
      coinsPerCent(packById("coins-1000")!),
    );
  });
});

describe("gift feed", () => {
  const rows: GiftFeedRow[] = [
    row({ id: "a", sender_id: "u1", coins: 1, sender: { username: "john" } }),
    row({ id: "b", sender_id: "u2", coins: 100, gift_type: "lion", sender: { username: "amy" } }),
    row({
      id: "c",
      sender_id: "u1",
      coins: 50,
      gift_type: "christmas",
      sender: { username: "john" },
    }),
  ];

  it("ranks senders by coins spent", () => {
    const top = topGifters(rows);
    expect(top[0]).toMatchObject({ name: "amy", coins: 100, gifts: 1 });
    expect(top[1]).toMatchObject({ name: "john", coins: 51, gifts: 2 });
  });

  it("limits the ranking", () => {
    expect(topGifters(rows, 1)).toHaveLength(1);
  });

  it("renders the top gifter line", () => {
    expect(topGifterLine(rows)).toBe("Top gifter: @amy — 100 coins");
    expect(topGifterLine([])).toBeNull();
  });

  it("renders ticker lines for known and unknown gifts", () => {
    expect(tickerLine(rows[1]!)).toBe("amy sent Lion 🦁");
    expect(tickerLine(row({ gift_type: "mystery", sender: { handle: "zed" } }))).toBe(
      "zed sent mystery 🎁",
    );
  });

  it("falls back to guest when a sender has no name", () => {
    expect(topGifters([row({ sender: null })])[0]!.name).toBe("guest");
    expect(tickerLine(row({ sender: null }))).toBe("Someone sent Rose 🌹");
  });
});
