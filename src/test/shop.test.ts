import { beforeEach, describe, expect, it } from "vitest";
import { SHOP_ITEMS, equip, findItem, getEquipped } from "@/lib/shop";

const H = "tester";

beforeEach(() => localStorage.clear());

describe("shop catalogue", () => {
  it("no longer offers third-party free trials", async () => {
    const shop = await import("@/lib/shop");
    expect("SHOP_PERKS" in shop).toBe(false);
  });

  it("groups items into tops, names and animals", () => {
    const kinds = new Set(SHOP_ITEMS.map((item) => item.kind));
    expect(kinds).toEqual(new Set(["top", "name", "animal"]));
    expect(SHOP_ITEMS.length).toBeGreaterThan(0);
  });

  it("starts with nothing equipped", () => {
    expect(getEquipped(H)).toEqual({});
  });

  it("equips one item per slot and can remove it", () => {
    const tee = findItem("top-tee")!;
    const hoodie = findItem("top-hoodie")!;
    equip(H, tee, "top");
    expect(getEquipped(H)).toEqual({ top: "top-tee" });
    equip(H, hoodie, "top");
    expect(getEquipped(H).top).toBe("top-hoodie");
    equip(H, null, "top");
    expect(getEquipped(H)).toEqual({});
  });

  it("keeps loadouts separate per account", () => {
    equip(H, findItem("name-gold")!, "name");
    expect(getEquipped("someone-else")).toEqual({});
  });

  it("ignores malformed storage", () => {
    localStorage.setItem(`shop-equipped:${H}`, "{not json");
    expect(getEquipped(H)).toEqual({});
  });
});
