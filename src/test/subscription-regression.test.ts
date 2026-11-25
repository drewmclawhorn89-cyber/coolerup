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

const H = "drewmclawhorn3";

/** Seed the server-backed grant cache the way `refreshLifetime` would. */
function serverRow(grant: Record<string, unknown>) {
  localStorage.setItem(`lifetime:${H}`, JSON.stringify(grant));
}

beforeEach(() => localStorage.clear());

describe("a server row does not freeze the subscription screen", () => {
  it("lets a new purchase override a server row", () => {
    serverRow({ plan: "plus", status: "active", isLifetime: false });

    requestPayment(H, "pro");

    expect(getSubscription(H)?.planId).toBe("pro");
    expect(getSubscription(H)?.status).toBe("pending");
  });

  it("lets a confirmed purchase activate over a server row", () => {
    serverRow({ plan: "plus", status: "active", isLifetime: false });

    requestPayment(H, "pro");
    confirmPayment(H);

    expect(getSubscription(H)?.planId).toBe("pro");
    expect(getSubscription(H)?.status).toBe("active");
    expect(planUnlocksOffline(H)).toBe(true);
  });

  it("actually cancels a server-backed plan", () => {
    serverRow({ plan: "plus", status: "active", isLifetime: false });

    cancelSubscription(H);

    expect(getSubscription(H)).toBeNull();
    expect(planUnlocksOffline(H)).toBe(false);
  });

  it("keeps the cancellation after the server row is refreshed again", () => {
    serverRow({ plan: "plus", status: "active", isLifetime: false });
    cancelSubscription(H);

    // A later refresh writes the same row back into the cache.
    serverRow({ plan: "plus", status: "active", isLifetime: false });

    expect(getSubscription(H)).toBeNull();
  });

  it("still lets a server row supply a plan when the device has none", () => {
    serverRow({ plan: "pro", status: "active", isLifetime: false });

    expect(getSubscription(H)?.planId).toBe("pro");
    expect(getSubscription(H)?.isLifetime).toBe(false);
    expect(planUnlocksOffline(H)).toBe(true);
  });

  it("never lets a local record outrank a lifetime grant", () => {
    serverRow({ plan: "all", status: "active", isLifetime: true });
    requestPayment(H, "plus");

    expect(getSubscription(H)?.planId).toBe("all");
    expect(getSubscription(H)?.isLifetime).toBe(true);
  });
});
