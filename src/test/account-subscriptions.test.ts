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
  {
    id: "all",
    plan_name: "All Access Forever",
    emoji: "👑",
    price_cents: 9999,
    perks: [
      "Everything in Plus, Pro and VIP",
      "Offline video downloads",
      "Offline music downloads",
      "Background play",
      "Beta features",
      "Never expires",
    ],
    offline: true,
    music_offline: true,
    background_play: true,
    sort_order: 4,
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

  it("migration enforces single row per user_id, Free default, payment_verified, and non-destructive cleanup", () => {
    const sql2026 = readFileSync(
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
    expect(sql2026).toContain("create table if not exists public.subscription_plans");
    expect(sql2026).toContain("add constraint user_subscriptions_user_id_key unique (user_id)");
    expect(sql2026).toContain("plan_status");
    expect(sql2026).toContain("payment_method");
    expect(sql2026).toContain("drewmclawhorn3");
    expect(sql2026).toContain("auth.uid() = user_id");

    const sql2027 = readFileSync(
      join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        "20270101000000_fix_free_default_and_payment_verified.sql",
      ),
      "utf8",
    );
    expect(sql2027).toContain("set default 'free'");
    expect(sql2027).toContain(
      "add column if not exists payment_verified boolean not null default false",
    );
    expect(sql2027).toContain("All Access Forever");
    expect(sql2027).toContain("plan_status = 'expired'");
    expect(sql2027).not.toMatch(/delete\s+from\s+public\.(profiles|videos|full_videos)/i);
  });

  it("proves a NEW account with no purchase shows Free (NEVER All Access Forever), then buying Forever -> logout -> login shows Active: All Access Forever", async () => {
    const { SubscriptionsPanel } = await import("@/components/SubscriptionsPanel");
    const NEW_USER = "22222222-2222-2222-2222-222222222222";
    const NEW_HANDLE = "brandnewuser";
    currentUser = NEW_USER;

    // 1. New test account logs in with NO subscription row in Supabase -> MUST show "Free".
    render(createElement(SubscriptionsPanel, { handle: NEW_HANDLE, userId: NEW_USER }));
    await waitFor(() => {
      expect(screen.getByText(/Current plan:/i)).toHaveTextContent("Current plan: Free");
    });
    expect(screen.queryByText(/Active: All Access Forever/i)).not.toBeInTheDocument();
    expect(subs.planUnlocksOffline(NEW_HANDLE)).toBe(false);

    // 2. Buy All Access Forever on that test account (payment_verified = true, expires_at = null).
    await subs.saveSubscriptionToAccount({
      userId: NEW_USER,
      handle: NEW_HANDLE,
      planId: "all",
      planName: "All Access Forever",
      status: "active",
      paymentMethod: "Visa •••• 4242",
      paymentVerified: true,
      expiresAt: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: NEW_USER,
      plan_id: "all",
      plan_name: "All Access Forever",
      plan_status: "active",
      payment_verified: true,
      expires_at: null,
    });

    cleanup();

    // 3. Log out (clear all client memory & localStorage).
    account.clearAccountSubscriptionCache();
    lifetime.clearLifetimeCache();
    expect(subs.getSubscription(NEW_HANDLE, NEW_USER)).toBeNull();
    expect(Object.keys(localStorage)).toEqual([]);

    // 4. Log in again on a different phone/browser -> MUST show "Active: All Access Forever" automatically!
    render(createElement(SubscriptionsPanel, { handle: NEW_HANDLE, userId: NEW_USER }));
    await waitFor(() => {
      expect(screen.getByText(/Current plan:/i)).toHaveTextContent(
        "Current plan: Active: All Access Forever",
      );
    });
    expect(screen.getByText("Current Plan")).toBeInTheDocument();
    expect(subs.subscriptionDisplayName(subs.getSubscription(NEW_HANDLE, NEW_USER))).toBe(
      "All Access Forever",
    );
  });

  it("rejects unverified All Access Forever rows, cancelled/expired/free rows, and expired monthly plans", async () => {
    const { SubscriptionsPanel } = await import("@/components/SubscriptionsPanel");

    // 1. Unverified Forever row in DB (payment_verified = false) -> MUST show "Free", NOT Forever.
    rows.push({
      id: "bogus-forever",
      user_id: USER,
      plan_id: "all",
      plan_name: "All Access Forever",
      plan_status: "active",
      status: "active",
      started_at: new Date().toISOString(),
      expires_at: null,
      payment_method: null,
      payment_verified: false,
      auto_renew: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await account.loadAccountSubscription(USER, HANDLE);
    expect(subs.getSubscription(HANDLE, USER)).toBeNull();
    expect(subs.subscriptionDisplayName(subs.getSubscription(HANDLE, USER))).toBe("Free");
    expect(subs.planUnlocksOffline(HANDLE)).toBe(false);

    render(createElement(SubscriptionsPanel, { handle: HANDLE, userId: USER }));
    await waitFor(() => {
      expect(screen.getByText(/Current plan:/i)).toHaveTextContent("Current plan: Free");
    });
    expect(screen.queryByText(/Active: All Access Forever/i)).not.toBeInTheDocument();
    cleanup();

    // Attempting to save active All Access Forever without verified payment MUST throw.
    await expect(
      account.saveAccountSubscription(USER, {
        planId: "all",
        planName: "All Access Forever",
        status: "active",
        startedAt: new Date().toISOString(),
        paymentVerified: false,
      }),
    ).rejects.toThrow(/verified payment/i);

    // 2. Cancelled / expired / free statuses -> show "Free" and lock perks.
    for (const status of ["cancelled", "expired", "free"] as const) {
      rows[0] = {
        ...rows[0]!,
        plan_id: "vip",
        plan_name: "VIP",
        plan_status: status,
        status,
        payment_verified: true,
        expires_at: new Date(Date.now() + 86400_000).toISOString(),
      };
      account.clearAccountSubscriptionCache();
      await account.loadAccountSubscription(USER, HANDLE);
      const sub = subs.getSubscription(HANDLE, USER);
      expect(subs.subscriptionDisplayName(sub)).toBe("Free");
      expect(subs.planUnlocksOffline(HANDLE)).toBe(false);
    }

    // 3. Monthly/Yearly plan past expires_at -> MUST show "Free" and lock paid features.
    rows[0] = {
      ...rows[0]!,
      plan_id: "vip",
      plan_name: "VIP",
      plan_status: "active",
      status: "active",
      payment_verified: true,
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    };
    account.clearAccountSubscriptionCache();
    await account.loadAccountSubscription(USER, HANDLE);
    const expiredSub = subs.getSubscription(HANDLE, USER);
    expect(expiredSub?.status).toBe("expired");
    expect(subs.subscriptionDisplayName(expiredSub)).toBe("Free");
    expect(subs.planUnlocksOffline(HANDLE)).toBe(false);
    expect(subs.planUnlocksMusicOffline(HANDLE)).toBe(false);
    expect(subs.planUnlocksBackgroundPlay(HANDLE)).toBe(false);

    // Owner @drewmclawhorn3 has All Access Forever, NEVER copied to non-owner users.
    await lifetime.refreshLifetime("drewmclawhorn3");
    expect(subs.getSubscription("drewmclawhorn3", USER)?.planId).toBe("all");
    const OTHER_USER = "33333333-3333-3333-3333-333333333333";
    await account.loadAccountSubscription(OTHER_USER, "regularuser");
    expect(subs.getSubscription("regularuser", OTHER_USER)).toBeNull();
    expect(subs.subscriptionDisplayName(subs.getSubscription("regularuser", OTHER_USER))).toBe(
      "Free",
    );
    expect(subs.planUnlocksOffline("regularuser")).toBe(false);
  });
});
