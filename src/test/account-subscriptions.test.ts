import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Real Account-Backed Subscriptions Proof & Verification:
 *
 * Proves all requirements end-to-end against simulated Phone A & Phone B sessions:
 * 1. Saved strictly to Supabase database keyed by user_id ONLY (1 row per user_id).
 *    Required fields: user_id, plan_name, plan_status, started_at, expires_at, payment_method.
 * 2. Switching plans updates the SAME user_id row (never creates duplicates).
 * 3. Zero localStorage/device storage ever written for subscription/plan/lifetime status.
 * 4. Loading spinner displays while fetching from Supabase (no "Free" flash).
 * 5. Test user buys a plan on Phone A -> logs out -> logs in on Phone B -> plan is
 *    active immediately with "Current Plan" marked and NO Restore button tap needed.
 * 6. Restore Subscription queries Supabase for user_id and returns active plan or null
 *    ("No paid plan found for this account").
 * 7. Owner @drewmclawhorn3 never loses their plan on login.
 */

type Row = Record<string, unknown> & { id: string };

const rows: Row[] = [];
const planRows: Row[] = [
  {
    id: "plus",
    plan_name: "Plus",
    emoji: "⭐",
    price_cents: 799,
    perks: ["Ad-free feed", "Plus badge on your profile", "Offline video downloads"],
    offline: true,
    music_offline: false,
    background_play: false,
    sort_order: 1,
    active: true,
  },
  {
    id: "pro",
    plan_name: "Pro",
    emoji: "🚀",
    price_cents: 1499,
    perks: [
      "Everything in Plus",
      "Offline video downloads",
      "Exclusive tops and names",
      "Priority uploads",
    ],
    offline: true,
    music_offline: false,
    background_play: false,
    sort_order: 2,
    active: true,
  },
  {
    id: "vip",
    plan_name: "VIP",
    emoji: "👑",
    price_cents: 2999,
    perks: [
      "Everything in Pro",
      "Offline video downloads",
      "Offline music downloads",
      "Background play",
      "VIP badge",
      "Early access to new features",
    ],
    offline: true,
    music_offline: true,
    background_play: true,
    sort_order: 3,
    active: true,
  },
];

let currentUser: string | null = null;
let queryDelayMs = 0;

function makeQuery(table: string) {
  const filters: Array<[string, unknown]> = [];
  let mode: "select" | "upsert" | "update" = "select";
  let payload: Record<string, unknown> | null = null;
  let conflict: string | undefined;

  const targetRows = () => (table === "subscription_plans" ? planRows : rows);

  const matching = (): Row[] =>
    targetRows().filter((row) =>
      filters.every(([column, value]) =>
        column.startsWith("!") ? row[column.slice(1)] !== value : row[column] === value,
      ),
    );

  const run = async (single: boolean): Promise<{ data: unknown; error: null }> => {
    if (queryDelayMs > 0) {
      await new Promise((r) => setTimeout(r, queryDelayMs));
    }
    if (mode === "upsert" && payload) {
      const columns = (conflict ?? "id").split(",");
      const existing = rows.find((row) => columns.every((c) => row[c] === payload![c]));
      if (existing) {
        Object.assign(existing, payload, { updated_at: new Date().toISOString() });
        return { data: existing, error: null };
      }
      const created: Row = {
        id: `row-${rows.length + 1}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        ...payload,
      };
      rows.push(created);
      return { data: created, error: null };
    }

    if (mode === "update" && payload) {
      const hit = matching();
      for (const row of hit) Object.assign(row, payload);
      return { data: hit, error: null };
    }

    const hit = matching();
    return { data: single ? (hit[0] ?? null) : hit, error: null };
  };

  const q: Record<string, unknown> = {
    select: () => q,
    eq: (column: string, value: unknown) => {
      filters.push([column, value]);
      return q;
    },
    neq: (column: string, value: unknown) => {
      filters.push([`!${column}`, value]);
      return q;
    },
    order: () => q,
    limit: () => q,
    upsert: (values: Record<string, unknown>, opts?: { onConflict?: string }) => {
      mode = "upsert";
      payload = values;
      conflict = opts?.onConflict;
      return q;
    },
    update: (values: Record<string, unknown>) => {
      mode = "update";
      payload = values;
      return q;
    },
    maybeSingle: () => run(true),
    then: <T>(
      onFulfilled?: ((value: { data: unknown; error: null }) => T | PromiseLike<T>) | null,
      onRejected?: ((reason: unknown) => unknown) | null,
    ) => run(false).then(onFulfilled, onRejected),
  };

  return q;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => makeQuery(table),
    rpc: async () => ({ data: null, error: null }),
    auth: {
      getUser: async () => ({ data: { user: currentUser ? { id: currentUser } : null } }),
    },
  },
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() },
}));

let account: typeof import("@/lib/accountSubscriptions");
let subs: typeof import("@/lib/subscriptions");
let lifetime: typeof import("@/lib/subscription");

const USER = "11111111-1111-1111-1111-111111111111";
const HANDLE = "testbuyer";

beforeEach(async () => {
  rows.length = 0;
  currentUser = USER;
  queryDelayMs = 0;
  localStorage.clear();
  vi.resetModules();
  account = await import("@/lib/accountSubscriptions");
  subs = await import("@/lib/subscriptions");
  lifetime = await import("@/lib/subscription");
  account.clearAccountSubscriptionCache();
  lifetime.clearLifetimeCache();
});

afterEach(() => {
  cleanup();
});

describe("real account-backed subscriptions (no device storage)", () => {
  it("saves all required fields and updates the SAME user_id row when changing plans", async () => {
    const started = new Date().toISOString();
    const expires = new Date(Date.now() + 30 * 86400_000).toISOString();

    await account.saveAccountSubscription(USER, {
      planId: "plus",
      planName: "Plus",
      status: "active",
      startedAt: started,
      expiresAt: expires,
      paymentMethod: "Visa •••• 4242",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: USER,
      plan_id: "plus",
      plan_name: "Plus",
      plan_status: "active",
      started_at: started,
      expires_at: expires,
      payment_method: "Visa •••• 4242",
    });

    // Switch plan from Plus -> VIP: MUST update the same user_id row (never create a second row).
    await account.saveAccountSubscription(USER, {
      planId: "vip",
      planName: "VIP",
      status: "active",
      startedAt: started,
      expiresAt: expires,
      paymentMethod: "Mastercard •••• 5555",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.["user_id"]).toBe(USER);
    expect(rows[0]?.["plan_id"]).toBe("vip");
    expect(rows[0]?.["plan_name"]).toBe("VIP");
    expect(rows[0]?.["plan_status"]).toBe("active");
    expect(rows[0]?.["payment_method"]).toBe("Mastercard •••• 5555");
  });

  it("proves Phone A buy -> logout -> Phone B login keeps plan automatically without Restore", async () => {
    const { SubscriptionsPanel } = await import("@/components/SubscriptionsPanel");

    // 1. Phone A: log in as test user, buy Pro plan with Card.
    const saved = await subs.saveSubscriptionToAccount({
      userId: USER,
      handle: HANDLE,
      planId: "pro",
      status: "active",
      paymentMethod: "Visa •••• 4242",
    });
    expect(saved.planId).toBe("pro");
    expect(saved.status).toBe("active");

    // Zero device storage was touched.
    expect(Object.keys(localStorage)).toEqual([]);

    // 2. Log out on Phone A (wipes all client memory).
    account.clearAccountSubscriptionCache();
    lifetime.clearLifetimeCache();
    expect(subs.getSubscription(HANDLE, USER)).toBeNull();

    // 3. Log in on Phone B (fresh browser / empty localStorage + slow network).
    queryDelayMs = 25;
    render(createElement(SubscriptionsPanel, { handle: HANDLE, userId: USER }));

    // Must show a loading spinner FIRST — NEVER flash "Free" or purchasable buttons before DB resolves.
    expect(screen.getByText(/Loading your subscription/i)).toBeInTheDocument();

    // After Supabase loads for USER, Pro is marked "Current Plan" automatically without tapping Restore!
    await waitFor(() => {
      expect(screen.getByText("Current Plan")).toBeInTheDocument();
    });
    expect(screen.getByText("Pro")).toBeInTheDocument();
    expect(screen.getByText(/Visa •••• 4242/)).toBeInTheDocument();
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("allows buying and switching plans directly via UI PaymentSheet flow", async () => {
    const { SubscriptionsPanel } = await import("@/components/SubscriptionsPanel");
    await account.saveAccountSubscription(USER, {
      planId: "plus",
      planName: "Plus",
      status: "active",
      startedAt: new Date().toISOString(),
      paymentMethod: "Visa •••• 4242",
    });
    await account.loadAccountSubscription(USER, HANDLE);

    render(createElement(SubscriptionsPanel, { handle: HANDLE, userId: USER }));

    await waitFor(() => {
      expect(screen.getByText("Current Plan")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Switch to VIP/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Switch to VIP/i }));
    await waitFor(() => {
      expect(screen.getByText("Pay for VIP")).toBeInTheDocument();
    });
  });

  it("Restore Subscription queries Supabase for user_id and returns null when none exists", async () => {
    const missing = await subs.restoreSubscription(HANDLE, USER);
    expect(missing).toBeNull();

    await account.saveAccountSubscription(USER, {
      planId: "vip",
      planName: "VIP",
      status: "active",
      startedAt: new Date().toISOString(),
      paymentMethod: "Visa •••• 4242",
    });
    account.clearAccountSubscriptionCache();
    expect(subs.getSubscription(HANDLE, USER)).toBeNull();

    const restored = await subs.restoreSubscription(HANDLE, USER);
    expect(restored?.planId).toBe("vip");
    expect(restored?.status).toBe("active");
    expect(subs.subscriptionDisplayName(restored)).toBe("VIP");

    // Cancelled subscription does NOT falsely restore as active.
    await account.saveAccountSubscription(USER, {
      planId: "vip",
      planName: "VIP",
      status: "cancelled",
      startedAt: new Date().toISOString(),
    });
    account.clearAccountSubscriptionCache();
    expect(await subs.restoreSubscription(HANDLE, USER)).toBeNull();
  });

  it("owner @drewmclawhorn3 never loses their plan on login", async () => {
    const ownerSub = subs.getSubscription("drewmclawhorn3", USER);
    expect(ownerSub?.status).toBe("active");
    expect(ownerSub?.planId).toBe("all");
    expect(ownerSub?.isLifetime).toBe(true);

    await lifetime.refreshLifetime("drewmclawhorn3");
    const afterRefresh = subs.getSubscription("drewmclawhorn3", USER);
    expect(afterRefresh?.status).toBe("active");
    expect(afterRefresh?.planId).toBe("all");
    expect(afterRefresh?.isLifetime).toBe(true);
  });

  it("never writes subscription, plan, or lifetime keys to localStorage", async () => {
    await subs.saveSubscriptionToAccount({
      userId: USER,
      handle: HANDLE,
      planId: "pro",
      status: "active",
      paymentMethod: "Visa •••• 4242",
    });
    await lifetime.refreshLifetime("drewmclawhorn3");

    const keys = Object.keys(localStorage);
    expect(keys.filter((k) => /subscription|lifetime|plan|paid/i.test(k))).toEqual([]);
  });

  it("migration enforces single row per user_id, subscription_plans, profiles sync, and owner protection", () => {
    const sql = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        "20261231000000_real_account_subscriptions.sql",
      ),
      "utf8",
    );
    expect(sql).toContain("create table if not exists public.subscription_plans");
    expect(sql).toContain("add constraint user_subscriptions_user_id_key unique (user_id)");
    expect(sql).toContain("plan_status");
    expect(sql).toContain("payment_method");
    expect(sql).toContain("drewmclawhorn3");
    expect(sql).toContain("auth.uid() = user_id");
  });
});
