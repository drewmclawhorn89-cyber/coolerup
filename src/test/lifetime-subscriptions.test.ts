import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lifetime grants: "give this person everything, forever, until I take it back".
 *
 * The database owns the grant and `src/lib/subscription.ts` mirrors it in
 * `localStorage` so sync UI gates don't flicker. These tests pin the rules that
 * matter:
 *
 *   1. An active lifetime grant wins, with NO expiry (`currentPeriodEnd` null).
 *   2. A revoked grant (status "canceled") beats even a local paid subscription —
 *      the user drops straight to the paywall.
 *   3. A lifetime "all" grant satisfies every plan id.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: null, error: { message: "offline" } }),
  },
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const { isLifetimeActive, isLifetimeRevoked, lifetimePlanLabel, LIFETIME_EVENT } =
  await import("@/lib/subscription");
const { getSubscription, hasPlanAccess } = await import("@/lib/subscriptions");
const { setCachedAccountSubscription } = await import("@/lib/accountSubscriptions");

const NON_OWNER = "vip-fan";

function seed(grant: Record<string, unknown>, handle = NON_OWNER) {
  localStorage.setItem(`lifetime:${handle}`, JSON.stringify(grant));
}

beforeEach(() => {
  localStorage.clear();
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

describe("getSubscription overlays a cached lifetime grant", () => {
  it("returns an active plan with no expiry date", () => {
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
});
