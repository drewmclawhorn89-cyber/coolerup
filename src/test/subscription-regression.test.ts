import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: "Subscriptions are not working at all" after the server-row
 * change in #278.
 *
 * #278 made `getSubscription` return *any* active row from
 * `public.subscriptions`, not just lifetime grants. That fixed offline mode for
 * real paid subscribers, but it also made the server row outrank the device's
 * own record. Once a row existed, buying, switching plan and cancelling all
 * wrote to localStorage and were then ignored - the panel kept showing the old
 * server plan, so the subscription screen looked completely dead.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: null, error: { message: "offline" } }),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const { getSubscription, planUnlocksOffline, requestPayment, confirmPayment, cancelSubscription } =
  await import("@/lib/subscriptions");
const { setCachedAccountSubscription } = await import("@/lib/accountSubscriptions");

const H = "drewmclawhorn3";

/** Seed the server-backed grant cache the way `refreshLifetime` would. */
function serverRow(grant: Record<string, unknown>) {
  localStorage.setItem(`lifetime:${H}`, JSON.stringify(grant));
}

beforeEach(() => localStorage.clear());

describe("an account row does not freeze the subscription screen", () => {
  const accountRow = (
    planId: string,
    status: "active" | "pending" | "cancelled" | "expired" | "trialing" = "active",
  ) =>
    setCachedAccountSubscription(H, {
      planId,
      status,
      startedAt: new Date().toISOString(),
    });

  it("lets a new purchase override an account row", () => {
    accountRow("plus");

    requestPayment(H, "pro");

    expect(getSubscription(H)?.planId).toBe("pro");
    expect(getSubscription(H)?.status).toBe("pending");
  });

  it("lets a confirmed purchase activate over an account row", () => {
    accountRow("plus");

    requestPayment(H, "pro");
    confirmPayment(H);

    expect(getSubscription(H)?.planId).toBe("pro");
    expect(getSubscription(H)?.status).toBe("active");
    expect(planUnlocksOffline(H)).toBe(true);
  });

  it("actually cancels an account-backed plan", () => {
    accountRow("plus");

    cancelSubscription(H);

    expect(getSubscription(H)).toBeNull();
    expect(planUnlocksOffline(H)).toBe(false);
  });

  it("keeps the cancellation after the account row is re-fetched", () => {
    accountRow("plus");
    cancelSubscription(H);

    // A later refresh brings the same row back, now marked cancelled.
    accountRow("plus", "cancelled");

    expect(planUnlocksOffline(H)).toBe(false);
    expect(getSubscription(H)?.status).toBe("expired");
  });

  it("still lets an account row supply a plan when the device has none", () => {
    accountRow("pro");

    expect(getSubscription(H)?.planId).toBe("pro");
    expect(getSubscription(H)?.isLifetime).toBe(false);
    expect(planUnlocksOffline(H)).toBe(true);
  });

  it("never lets an account row outrank a lifetime grant", () => {
    localStorage.setItem(
      `lifetime:${H}`,
      JSON.stringify({ plan: "all", status: "active", isLifetime: true }),
    );
    accountRow("plus");

    expect(getSubscription(H)?.planId).toBe("all");
    expect(getSubscription(H)?.isLifetime).toBe(true);
  });
});
