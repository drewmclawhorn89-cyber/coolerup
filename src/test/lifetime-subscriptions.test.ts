import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Lifetime grants: "give this person everything, forever, until I take it back".
 *
 * The database owns the grant. The client keeps a localStorage copy under
 * `lifetime:<handle>` so the first paint is instant, and `getSubscription`
 * overlays that copy on top of the ordinary paid/code subscription. These tests
 * pin the three rules that matter:
 *
 *   1. An active lifetime grant wins, with NO expiry (`currentPeriodEnd` null).
 *   2. A revoked grant (status "canceled") drops the user straight to the
 *      paywall - it must not fall back to a stale localStorage plan.
 *   3. A lifetime "all" grant satisfies every plan id, including ones that do
 *      not exist yet.
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

const H = "drewmclawhorn3";

function seed(grant: Record<string, unknown>) {
  localStorage.setItem(`lifetime:${H}`, JSON.stringify(grant));
}

beforeEach(() => localStorage.clear());

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

describe("getSubscription overlays a lifetime grant", () => {
  it("returns an active plan with no expiry date", () => {
    seed({
      plan: "all",
      status: "active",
      isLifetime: true,
      grantedBy: "drewmclawhorn3",
      grantedAt: "2026-11-08T12:00:00.000Z",
    });

    const sub = getSubscription(H);

    expect(sub).not.toBeNull();
    expect(sub?.planId).toBe("all");
    expect(sub?.status).toBe("active");
    expect(sub?.isLifetime).toBe(true);
    expect(sub?.grantedBy).toBe("drewmclawhorn3");
    // The whole point: never expires.
    expect(sub?.currentPeriodEnd).toBeNull();
  });

  it("drops a revoked user to the paywall, ignoring any stale paid plan", () => {
    // A leftover paid plan in the ordinary slot must not survive the revoke.
    localStorage.setItem(
      `subscription:${H}`,
      JSON.stringify({
        planId: "vip",
        status: "active",
        startedAt: "2026-01-01T00:00:00.000Z",
        currentPeriodEnd: "2099-01-01T00:00:00.000Z",
      }),
    );
    seed({ plan: "all", status: "canceled", isLifetime: false, revokedAt: "2026-11-09T00:00:00Z" });

    expect(getSubscription(H)).toBeNull();
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
    expect(hasPlanAccess(H, "plus")).toBe(true);
    expect(hasPlanAccess(H, "pro")).toBe(true);
    expect(hasPlanAccess(H, "vip")).toBe(true);
  });

  it("unlocks a plan id that does not exist yet", () => {
    expect(hasPlanAccess(H, "some-future-tier")).toBe(true);
  });
});

describe("event name", () => {
  it("is stable, so the subscription hook can listen for revokes", () => {
    expect(LIFETIME_EVENT).toBe("lifetime-change");
  });
});
