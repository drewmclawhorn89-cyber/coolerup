import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Subscriptions belong to the account, not the device.
 *
 * These tests stand in for the real Supabase client with a tiny in-memory
 * table that honours the same calls the app makes (`select`/`eq`/`upsert` with
 * `onConflict`, `update`). The scenario they pin down is the one from the bug
 * report: buy on Phone A, sign out, sign in on Phone B with the same account,
 * and the plan must still be there - with no device storage involved.
 */

type Row = Record<string, unknown> & { id: string };

const rows: Row[] = [];
let currentUser: string | null = null;

function matches(row: Row, filters: Array<[string, unknown]>): boolean {
  return filters.every(([column, value]) => row[column] === value);
}

class Query {
  private filters: Array<[string, unknown]> = [];
  private mode: "select" | "upsert" | "update" = "select";
  private payload: Record<string, unknown> | null = null;
  private conflict: string | undefined;

  select(): this {
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push([`!${column}`, value]);
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  upsert(values: Record<string, unknown>, opts?: { onConflict?: string }): this {
    this.mode = "upsert";
    this.payload = values;
    this.conflict = opts?.onConflict;
    return this;
  }
  update(values: Record<string, unknown>): this {
    this.mode = "update";
    this.payload = values;
    return this;
  }
  maybeSingle(): Promise<{ data: unknown; error: null }> {
    return Promise.resolve(this.run(true));
  }
  then<T>(
    onFulfilled?: ((value: { data: unknown; error: null }) => T | PromiseLike<T>) | null,
    onRejected?: ((reason: unknown) => unknown) | null,
  ): Promise<T | unknown> {
    return Promise.resolve(this.run(false)).then(onFulfilled, onRejected);
  }

  private matching(): Row[] {
    return rows.filter((row) =>
      this.filters.every(([column, value]) =>
        column.startsWith("!") ? row[column.slice(1)] !== value : row[column] === value,
      ),
    );
  }

  private run(single: boolean): { data: unknown; error: null } {
    if (this.mode === "upsert" && this.payload) {
      const columns = (this.conflict ?? "id").split(",");
      const existing = rows.find((row) => columns.every((c) => row[c] === this.payload![c]));
      if (existing) {
        Object.assign(existing, this.payload, { updated_at: new Date().toISOString() });
        return { data: existing, error: null };
      }
      const created: Row = {
        id: `row-${rows.length + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...this.payload,
      };
      rows.push(created);
      return { data: created, error: null };
    }

    if (this.mode === "update" && this.payload) {
      const hit = this.matching();
      for (const row of hit) Object.assign(row, this.payload);
      return { data: hit, error: null };
    }

    const hit = this.matching();
    return { data: single ? (hit[0] ?? null) : hit, error: null };
  }
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => new Query(),
    auth: {
      getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null } }),
    },
  },
}));

let account: typeof import("@/lib/accountSubscriptions");
let subs: typeof import("@/lib/subscriptions");

const USER = "11111111-1111-1111-1111-111111111111";
const PHONE_A = "drew-on-phone-a";
const PHONE_B = "drew-on-phone-b";

beforeEach(async () => {
  rows.length = 0;
  currentUser = USER;
  localStorage.clear();
  // Fresh module graph per test so the in-memory cache starts empty and the
  // Supabase mock above is the one the store binds to.
  vi.resetModules();
  account = await import("@/lib/accountSubscriptions");
  subs = await import("@/lib/subscriptions");
  account.clearAccountSubscriptionCache();
});

describe("subscriptions are saved to the account", () => {
  it("survives a logout and a login on a different phone", async () => {
    // Phone A: buy Pro.
    await account.saveAccountSubscription(USER, {
      planId: "pro",
      planName: "Pro",
      status: "active",
      startedAt: new Date().toISOString(),
    });
    await account.loadAccountSubscription(USER, PHONE_A);
    expect(subs.getSubscription(PHONE_A)?.planId).toBe("pro");

    // Logout on Phone A: nothing is left on screen.
    account.clearAccountSubscriptionCache();
    expect(subs.getSubscription(PHONE_A)).toBeNull();

    // Phone B: same account, no restore button, no device storage.
    await account.loadAccountSubscription(USER, PHONE_B);
    expect(subs.getSubscription(PHONE_B)?.planId).toBe("pro");
    expect(subs.getSubscription(PHONE_B)?.status).toBe("active");
  });

  it("updates the same row instead of duplicating it", async () => {
    await account.saveAccountSubscription(USER, {
      planId: "pro",
      planName: "Pro",
      status: "pending",
      startedAt: new Date().toISOString(),
    });
    await account.saveAccountSubscription(USER, {
      planId: "pro",
      planName: "Pro",
      status: "active",
      startedAt: new Date().toISOString(),
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.["status"]).toBe("active");
  });

  it("cancels the old plan when a different one is bought", async () => {
    await account.saveAccountSubscription(USER, {
      planId: "plus",
      planName: "Plus",
      status: "active",
      startedAt: new Date().toISOString(),
    });
    await account.saveAccountSubscription(USER, {
      planId: "vip",
      planName: "VIP",
      status: "active",
      startedAt: new Date().toISOString(),
    });

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r["plan_id"] === "plus")?.["status"]).toBe("cancelled");
    expect(rows.find((r) => r["plan_id"] === "vip")?.["status"]).toBe("active");

    await account.loadAccountSubscription(USER, PHONE_B);
    expect(subs.getSubscription(PHONE_B)?.planId).toBe("vip");
  });

  it("shows nothing when the account has no row", async () => {
    await account.loadAccountSubscription(USER, PHONE_B);
    expect(subs.getSubscription(PHONE_B)).toBeNull();
  });

  it("Restore Subscription re-fetches the plan from the account", async () => {
    await account.saveAccountSubscription(USER, {
      planId: "vip",
      planName: "VIP",
      status: "active",
      startedAt: new Date().toISOString(),
    });
    account.clearCachedAccountSubscription(PHONE_B);
    account.clearAccountSubscriptionCache();
    expect(subs.getSubscription(PHONE_B)).toBeNull();

    const restored = await subs.restoreSubscription(PHONE_B);
    expect(restored?.planId).toBe("vip");
    expect(subs.getSubscription(PHONE_B)?.planId).toBe("vip");
  });

  it("never writes subscription state to device storage", async () => {
    subs.requestPayment(PHONE_A, "pro");
    subs.confirmPayment(PHONE_A);
    await account.saveAccountSubscription(USER, {
      planId: "pro",
      planName: "Pro",
      status: "active",
      startedAt: new Date().toISOString(),
    });

    const keys = Object.keys(localStorage);
    expect(keys.filter((key) => key.startsWith("subscription"))).toEqual([]);
  });

  it("the migration enables RLS with owner-only policies", () => {
    const sql = readFileSync(
      join(__dirname, "..", "..", "supabase", "migrations", "20261230000000_user_subscriptions.sql"),
      "utf8",
    );
    expect(sql).toContain("create table if not exists public.user_subscriptions");
    expect(sql).toContain("unique (user_id, plan_id)");
    expect(sql).toContain("references auth.users(id) on delete cascade");
    expect(sql).toContain("alter table public.user_subscriptions enable row level security");
    for (const action of ["select", "insert", "update", "delete"]) {
      expect(sql.toLowerCase()).toContain(`for ${action}`);
    }
    expect(sql).toContain("auth.uid() = user_id");
  });
});
