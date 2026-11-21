import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { CODE_PLANS, codePlanId, codePlanLabel, normalizeCode } from "@/lib/codes";

/**
 * The new code batch and the Pro tier.
 *
 * Codes used to be limited to `basic` (Plus) and `premium` (VIP), which left
 * Pro - the middle tier - as the one plan nobody could receive from a gift
 * card. These tests pin both halves of the change: the client mapping, and the
 * SQL that widens the constraint and mints the codes.
 */

const MIGRATION = "supabase/migrations/20261213000000_new_subscription_codes.sql";
const sql = readFileSync(MIGRATION, "utf8");

/** Every `('CODE', 'plan', months, max_uses, expires, by, active)` tuple. */
function codeRows(): { code: string; plan: string; months: number; maxUses: number }[] {
  const rows: { code: string; plan: string; months: number; maxUses: number }[] = [];
  const re = /\('([A-Z0-9-]+)',\s*'(basic|pro|premium)',\s*(\d+),\s*(\d+),/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    rows.push({ code: m[1]!, plan: m[2]!, months: Number(m[3]), maxUses: Number(m[4]) });
  }
  return rows;
}

describe("Pro codes", () => {
  it("maps the pro tier onto the app's pro plan", () => {
    expect(CODE_PLANS.pro.planId).toBe("pro");
    expect(codePlanId("pro")).toBe("pro");
    expect(codePlanLabel("pro")).toBe("Pro");
  });

  it("keeps the existing basic and premium mappings", () => {
    expect(codePlanId("basic")).toBe("plus");
    expect(codePlanId("premium")).toBe("vip");
    expect(codePlanLabel("basic")).toBe("Basic");
    expect(codePlanLabel("premium")).toBe("Premium");
  });

  it("falls back to Plus for an unknown tier", () => {
    expect(codePlanId("platinum")).toBe("plus");
  });
});

describe("the new code batch", () => {
  it("widens the plan constraint to accept pro", () => {
    expect(sql).toContain("check (plan in ('basic', 'pro', 'premium'))");
  });

  it("lets the admin RPC mint a pro code", () => {
    expect(sql).toContain("_plan not in ('basic', 'pro', 'premium')");
  });

  it("mints codes for every tier", () => {
    const rows = codeRows();
    const plans = new Set(rows.map((r) => r.plan));
    expect(plans).toEqual(new Set(["basic", "pro", "premium"]));
  });

  it("mints more than a hundred codes", () => {
    expect(codeRows().length).toBeGreaterThan(100);
  });

  it("has no duplicate codes", () => {
    const rows = codeRows();
    const codes = rows.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("only uses the months the database allows", () => {
    for (const row of codeRows()) {
      expect([1, 3, 12]).toContain(row.months);
    }
  });

  it("gives every code at least one use", () => {
    for (const row of codeRows()) {
      expect(row.maxUses).toBeGreaterThanOrEqual(1);
    }
  });

  it("normalises to the stored form, so a typed code still matches", () => {
    for (const row of codeRows()) {
      expect(normalizeCode(` ${row.code.toLowerCase()} `)).toBe(row.code);
    }
  });

  it("is safe to re-run", () => {
    expect(sql).toContain("on conflict (code) do nothing");
  });
});
