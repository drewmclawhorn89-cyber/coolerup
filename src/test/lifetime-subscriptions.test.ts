import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lifetime grants: "give this person everything, forever, until I take it back".
 *
 * The database owns the grant. Nothing is stored in localStorage or any device
 * store. These tests pin the rules that matter:
 *
 *   1. An active lifetime grant wins, with NO expiry (`currentPeriodEnd` null).
 *   2. A revoked grant (status "canceled") for a normal user drops them
 *      straight to the paywall.
 *   3. A lifetime "all" grant satisfies every plan id.
 *   4. Owner @drewmclawhorn3 NEVER loses their plan on login or refresh.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: null, error: { message: "offline" } }),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const {
  isLifetimeActive,
  isLifetimeRevoked,
  lifetimePlanLabel,
  setCachedLifetimeGrant,
  clearLifetimeCache,
  refreshLifetime,
  LIFETIME_EVENT,
} = await import("@/lib/subscription");
const { getSubscription, hasPlanAccess } = await import("@/lib/subscriptions");
const { setCachedAccountSubscription } = await import("@/lib/accountSubscriptions");

const NON_OWNER = "vip-fan";
const OWNER = "drewmclawhorn3";

function seed(grant: Record<string, unknown>, handle = NON_OWNER) {
  setCachedLifetimeGrant(handle, grant as never);
}

beforeEach(() => {
  localStorage.clear();
  clearLifetimeCache();
});

describe("grant predicates", () => {
  it("treats active + is_lifetime as live", () => {
    expect(isLifetimeActive({ plan: "all", status: "active", isLifetime: true } as never)).toBe(
      true,
    );
  });

  it("is not live once canceled", () => {
    const grant = { plan: "all", status: "canceled", isLifetime: false } as never;
    expect(isLifetimeActive(grant)).toBe(false);
    expect(isLifetimeRevoked(grant)).toBe(true);
  });

  it("labels each tier", () => {
    expect(lifetimePlanLabel("pro")).toBe("Pro Forever");
    expect(lifetimePlanLabel("vip")).toBe("VIP Forever");
    expect(lifetimePlanLabel("all")).toBe("All Access Forever");
  });
});

describe("getSubscription overlays a lifetime grant without device storage", () => {
  it("returns an active plan with no expiry date and writes zero localStorage", () => {
    seed({
      plan: "all",
      status: "active",
      isLifetime: true,
      grantedBy: "drewmclawhorn3",
      grantedAt: "2026-11-08T12:00:00.000Z",
    });

    const sub = getSubscription(NON_OWNER);

    expect(sub).not.toBeNull();
    expect(sub?.planId).toBe("all");
    expect(sub?.status).toBe("active");
    expect(sub?.isLifetime).toBe(true);
    expect(sub?.grantedBy).toBe("drewmclawhorn3");
    expect(sub?.currentPeriodEnd).toBeNull();
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("drops a revoked user to the paywall, ignoring any stale paid plan", () => {
    setCachedAccountSubscription(NON_OWNER, {
      planId: "vip",
      status: "active",
      startedAt: "2026-01-01T00:00:00.000Z",
    });
    seed({ plan: "all", status: "canceled", isLifetime: false, revokedAt: "2026-11-09T00:00:00Z" });

    expect(getSubscription(NON_OWNER)).toBeNull();
  });

  it("keeps owner @drewmclawhorn3 active forever even when DB refresh fails", async () => {
    await refreshLifetime(OWNER);
    const sub = getSubscription(OWNER);
    expect(sub).not.toBeNull();
    expect(sub?.status).toBe("active");
    expect(sub?.planId).toBe("all");
    expect(sub?.isLifetime).toBe(true);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("has no grant at all for an untouched handle", () => {
    expect(getSubscription("nobody")).toBeNull();
  });
});

describe("hasPlanAccess with a lifetime all grant", () => {
  beforeEach(() => {
    seed({ plan: "all", status: "active", isLifetime: true, grantedBy: "drewmclawhorn3" });
  });

  it("unlocks every purchasable plan", () => {
    expect(hasPlanAccess(NON_OWNER, "plus")).toBe(true);
    expect(hasPlanAccess(NON_OWNER, "pro")).toBe(true);
    expect(hasPlanAccess(NON_OWNER, "vip")).toBe(true);
  });

  it("unlocks a plan id that does not exist yet", () => {
    expect(hasPlanAccess(NON_OWNER, "some-future-tier")).toBe(true);
  });
});

describe("event name", () => {
  it("is stable, so the subscription hook can listen for revokes", () => {
    expect(LIFETIME_EVENT).toBe("lifetime-change");
  });

  it("ignores active non-owner grant when paymentVerified is false", () => {
    seed({
      plan: "all",
      status: "active",
      isLifetime: true,
      paymentVerified: false,
      grantedBy: null,
    });
    expect(getSubscription(NON_OWNER)).toBeNull();
  });
});
