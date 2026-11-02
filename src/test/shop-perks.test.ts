import { beforeEach, describe, expect, it } from "vitest";
import {
  SHOP_PERKS,
  claimPerk,
  getClaimedPerks,
  hasClaimedPerk,
  type ShopPerk,
} from "@/lib/shop";

const H = "tester";

const HULU = SHOP_PERKS.find((p) => p.id === "hulu-trial") as ShopPerk;

beforeEach(() => localStorage.clear());

describe("shop free trials", () => {
  it("lists a Hulu trial with 30 days", () => {
    expect(HULU).toBeTruthy();
    expect(HULU.label).toBe("Hulu");
    expect(HULU.days).toBe(30);
    expect(HULU.url).toMatch(/^https:\/\/www\.hulu\.com/);
  });

  it("starts with nothing claimed", () => {
    expect(getClaimedPerks(H)).toEqual([]);
    expect(hasClaimedPerk(H, HULU.id)).toBe(false);
  });

  it("claims a trial once per account", () => {
    expect(claimPerk(H, HULU.id)).toBe(true);
    expect(hasClaimedPerk(H, HULU.id)).toBe(true);
    expect(claimPerk(H, HULU.id)).toBe(false);
    expect(getClaimedPerks(H)).toEqual([HULU.id]);
  });

  it("keeps claims separate per account", () => {
    claimPerk(H, HULU.id);
    expect(hasClaimedPerk("someone-else", HULU.id)).toBe(false);
  });

  it("ignores malformed storage", () => {
    localStorage.setItem(`shop-perks:${H}`, "{not json");
    expect(getClaimedPerks(H)).toEqual([]);
    localStorage.setItem(`shop-perks:${H}`, JSON.stringify([1, "hulu-trial", null]));
    expect(getClaimedPerks(H)).toEqual(["hulu-trial"]);
  });
});
