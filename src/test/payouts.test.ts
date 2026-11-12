import { describe, expect, it } from "vitest";
import {
  DIAMOND_VALUE_USD,
  MIN_PAYOUT,
  MIN_PAYOUT_DIAMONDS,
  amountToPayout,
  canRequestPayout,
  cashableBalance,
  formatDiamonds,
  formatUsd,
  venmoPayoutUrl,
} from "@/lib/payouts";
import {
  CREATOR_FUND_MILESTONES,
  QUALIFY_FOLLOWERS,
  QUALIFY_VIEWS_30D,
  formatViews,
  isQualified,
  milestoneAmount,
  milestoneProgress,
  nextMilestoneFor,
} from "@/lib/creatorFund";

describe("payout money rules", () => {
  it("values a diamond at one cent", () => {
    expect(DIAMOND_VALUE_USD).toBe(0.01);
    expect(MIN_PAYOUT).toBe(10);
    expect(MIN_PAYOUT_DIAMONDS).toBe(1000);
  });

  it("formats dollars with two decimals and clamps garbage", () => {
    expect(formatUsd(1)).toBe("$1.00");
    expect(formatUsd(12.5)).toBe("$12.50");
    expect(formatUsd(-4)).toBe("$0.00");
    expect(formatUsd(null)).toBe("$0.00");
    expect(formatUsd(Number.NaN)).toBe("$0.00");
  });

  it("formats diamonds with thousands separators", () => {
    expect(formatDiamonds(1234)).toBe("1,234");
    expect(formatDiamonds(0)).toBe("0");
    expect(formatDiamonds(undefined)).toBe("0");
  });

  it("adds diamonds and real balance into one cashable number", () => {
    expect(cashableBalance(1000, 0)).toBe(10);
    expect(cashableBalance(0, 4.25)).toBe(4.25);
    expect(cashableBalance(250, 1.5)).toBe(4);
    expect(cashableBalance(-10, -5)).toBe(0);
  });

  it("only allows a cashout at the $10 minimum", () => {
    expect(canRequestPayout(9.99)).toBe(false);
    expect(canRequestPayout(10)).toBe(true);
    expect(canRequestPayout(42)).toBe(true);
    expect(canRequestPayout(null)).toBe(false);
  });

  it("reports how much is left to reach the minimum", () => {
    expect(amountToPayout(0)).toBe(10);
    expect(amountToPayout(7.5)).toBe(2.5);
    expect(amountToPayout(10)).toBe(0);
    expect(amountToPayout(99)).toBe(0);
  });

  it("builds a Venmo payout link with the exact amount", () => {
    const url = new URL(venmoPayoutUrl("@Drew-McLawhorn-2", 12.5));
    expect(url.origin).toBe("https://venmo.com");
    expect(url.searchParams.get("txn")).toBe("pay");
    expect(url.searchParams.get("recipients")).toBe("Drew-McLawhorn-2");
    expect(url.searchParams.get("amount")).toBe("12.50");
    expect(url.searchParams.get("note")).toContain("Coolerup");
  });
});

describe("creator fund", () => {
  it("has the four per-view milestones", () => {
    expect(CREATOR_FUND_MILESTONES.map((m) => m.views)).toEqual([1000, 10000, 100000, 1000000]);
    expect(CREATOR_FUND_MILESTONES.map((m) => m.amount)).toEqual([0.02, 0.2, 2, 20]);
  });

  it("requires 10 followers and 10K views in 30 days", () => {
    expect(QUALIFY_FOLLOWERS).toBe(10);
    expect(QUALIFY_VIEWS_30D).toBe(10000);
    expect(isQualified(9, 50000)).toBe(false);
    expect(isQualified(10, 9999)).toBe(false);
    expect(isQualified(10, 10000)).toBe(true);
  });

  it("finds the next unpaid milestone", () => {
    expect(nextMilestoneFor(0)).toBe(1000);
    expect(nextMilestoneFor(999)).toBe(1000);
    expect(nextMilestoneFor(1000)).toBe(10000);
    expect(nextMilestoneFor(150000)).toBe(1000000);
    expect(nextMilestoneFor(1000000)).toBeNull();
  });

  it("maps a milestone to its payout", () => {
    expect(milestoneAmount(1000)).toBe(0.02);
    expect(milestoneAmount(1000000)).toBe(20);
    expect(milestoneAmount(1234)).toBe(0);
  });

  it("tracks progress between milestones", () => {
    expect(milestoneProgress(0)).toBe(0);
    expect(milestoneProgress(500)).toBe(0.5);
    expect(milestoneProgress(1000)).toBe(0);
    expect(milestoneProgress(5500)).toBe(0.5);
    expect(milestoneProgress(1000000)).toBe(1);
  });

  it("shortens view counts", () => {
    expect(formatViews(999)).toBe("999");
    expect(formatViews(1000)).toBe("1K");
    expect(formatViews(12345)).toBe("12.3K");
    expect(formatViews(1000000)).toBe("1M");
    expect(formatViews(2500000)).toBe("2.5M");
    expect(formatViews(null)).toBe("0");
  });
});
