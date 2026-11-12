import { describe, expect, it } from "vitest";
import {
  FOLLOWER_REWARD_AMOUNT,
  MIN_REAL_CASHOUT,
  canCashOut,
  formatRealMoney,
  venmoCashoutUrl,
} from "@/lib/follow";
import { confettiPieces } from "@/lib/confetti";

/**
 * The creator fund pays $1.00 of real money for a first follower. The money
 * itself is decided in SQL (trigger + unique index), so these tests pin down
 * the client-side rules that must agree with it: the amount, the cashout gate,
 * and the payout link.
 */

describe("creator fund constants", () => {
  it("pays exactly $1.00 and needs $1.00 to cash out", () => {
    expect(FOLLOWER_REWARD_AMOUNT).toBe(1);
    expect(MIN_REAL_CASHOUT).toBe(1);
  });
});

describe("formatRealMoney", () => {
  it("always shows two decimals", () => {
    expect(formatRealMoney(1)).toBe("$1.00");
    expect(formatRealMoney(0)).toBe("$0.00");
    expect(formatRealMoney(12.5)).toBe("$12.50");
    expect(formatRealMoney(0.005)).toBe("$0.01");
  });

  it("never renders a negative balance", () => {
    expect(formatRealMoney(-4)).toBe("$0.00");
  });

  it("survives null and NaN", () => {
    expect(formatRealMoney(null)).toBe("$0.00");
    expect(formatRealMoney(undefined)).toBe("$0.00");
    expect(formatRealMoney(Number.NaN)).toBe("$0.00");
  });
});

describe("canCashOut", () => {
  it("allows an unclaimed reward with at least $1", () => {
    expect(canCashOut(1, false)).toBe(true);
    expect(canCashOut(5.25, false)).toBe(true);
  });

  it("blocks an empty balance", () => {
    expect(canCashOut(0, false)).toBe(false);
    expect(canCashOut(0.99, false)).toBe(false);
    expect(canCashOut(null, false)).toBe(false);
  });

  it("blocks a reward that was already paid out", () => {
    expect(canCashOut(1, true)).toBe(false);
  });
});

describe("venmoCashoutUrl", () => {
  it("pre-fills a $1.00 payout to the given handle", () => {
    const url = new URL(venmoCashoutUrl("@drewmclawhorn3"));
    expect(url.origin + url.pathname).toBe("https://venmo.com/");
    expect(url.searchParams.get("txn")).toBe("pay");
    expect(url.searchParams.get("recipients")).toBe("drewmclawhorn3");
    expect(url.searchParams.get("amount")).toBe("1.00");
    expect(url.searchParams.get("note")).toContain("creator fund");
  });

  it("honours a custom amount", () => {
    const url = new URL(venmoCashoutUrl("someone", 2.5));
    expect(url.searchParams.get("amount")).toBe("2.50");
  });
});

describe("confettiPieces", () => {
  it("builds the requested number of pieces inside the viewport", () => {
    const pieces = confettiPieces(40);
    expect(pieces).toHaveLength(40);
    for (const p of pieces) {
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left).toBeLessThanOrEqual(100);
      expect(p.duration).toBeGreaterThan(0);
      expect(p.size).toBeGreaterThan(0);
    }
  });

  it("is deterministic so the burst doesn't jump between renders", () => {
    expect(confettiPieces(10, 3)).toEqual(confettiPieces(10, 3));
    expect(confettiPieces(10, 3)).not.toEqual(confettiPieces(10, 4));
  });
});
