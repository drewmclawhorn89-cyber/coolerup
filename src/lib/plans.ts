/**
 * Plan catalogue.
 *
 * Kept free of React and browser APIs so the server can import it too — the
 * server must never trust a price sent by the client when charging a card.
 */

export type Plan = {
  id: string;
  label: string;
  emoji: string;
  /** price in USD per month */
  price: number;
  perks: string[];
  /**
   * Whether the plan unlocks offline *video* downloads.
   *
   * Offline video downloads are included on every paid tier (Plus, Pro and
   * VIP); only free accounts see a locked toggle with an upgrade prompt.
   * Offline *music* is a separate, VIP-only flag — see `musicOffline`. Never
   * write the price into a comment — it goes stale.
   */
  offline: boolean;
  /**
   * Whether the plan unlocks offline *music* downloads.
   *
   * Music offline is a VIP-only perk (plus the lifetime "all access" grant).
   * Pro still includes offline *video* downloads, which is why the two flags
   * are separate: moving music to VIP must not take videos away from Pro.
   */
  musicOffline: boolean;
  /**
   * Whether the plan unlocks background play.
   *
   * Background play is a VIP-only perk (plus the lifetime "all access" grant).
   * Plus and Pro keep offline *video* downloads but cannot keep audio running
   * once the app is hidden.
   */
  backgroundPlay: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "plus",
    label: "Plus",
    emoji: "\u2b50",
    price: 7.99,
    perks: ["Ad-free feed", "Plus badge on your profile", "Offline video downloads"],
    offline: true,
    musicOffline: false,
    backgroundPlay: false,
  },
  {
    id: "pro",
    label: "Pro",
    emoji: "\ud83d\ude80",
    price: 14.99,
    perks: [
      "Everything in Plus",
      "Offline video downloads",
      "Exclusive tops and names",
      "Priority uploads",
    ],
    offline: true,
    musicOffline: false,
    backgroundPlay: false,
  },
  {
    id: "vip",
    label: "VIP",
    emoji: "\ud83d\udc51",
    price: 29.99,
    perks: [
      "Everything in Pro",
      "Offline video downloads",
      "Offline music downloads",
      "Background play",
      "VIP badge",
      "Early access to new features",
    ],
    offline: true,
    musicOffline: true,
    backgroundPlay: true,
  },
];

/**
 * The lifetime tier.
 *
 * Deliberately *not* in `PLANS`: that array is the purchasable catalogue, and
 * nobody can buy this one. It exists so `planById("all")` resolves and every
 * perk check (`planIncludesOffline`, `hasPlanAccess`) answers "yes" for a
 * lifetime grant instead of falling through to the free tier.
 */
export const LIFETIME_PLAN: Plan = {
  id: "all",
  label: "Lifetime All Access",
  emoji: "\u{1F451}",
  price: 0,
  perks: [
    "Everything in Plus, Pro and VIP",
    "Offline video downloads",
    "Offline music downloads",
    "Background play",
    "Beta features",
    "1,000 coins",
    "Never expires",
  ],
  offline: true,
  musicOffline: true,
  backgroundPlay: true,
};

export function planById(id?: string | null): Plan | undefined {
  if (id === LIFETIME_PLAN.id) return LIFETIME_PLAN;
  return PLANS.find((p) => p.id === id);
}

/** True when this plan id is the lifetime "everything" tier. */
export function isLifetimePlan(id?: string | null): boolean {
  return id === LIFETIME_PLAN.id;
}

/** True when the plan unlocks offline downloads (video or music). */
export function planIncludesOffline(id?: string | null): boolean {
  return Boolean(planById(id)?.offline);
}

/**
 * True when the plan unlocks offline *music* downloads.
 *
 * Music is deliberately gated at VIP so Pro keeps video downloads without
 * getting the music library too. The lifetime "all access" plan includes it.
 */
export function planIncludesMusicOffline(id?: string | null): boolean {
  return Boolean(planById(id)?.musicOffline);
}

/**
 * True when the plan unlocks background play.
 *
 * Background play is deliberately gated at VIP so Pro keeps offline video
 * downloads without keeping audio alive once the app is hidden. The lifetime
 * "all access" plan includes it.
 */
export function planIncludesBackgroundPlay(id?: string | null): boolean {
  return Boolean(planById(id)?.backgroundPlay);
}

/**
 * The cheapest plan that includes offline downloads.
 *
 * Used by the upsell copy so the prompt always names the plan a viewer would
 * actually have to buy. Falls back to the last plan if the catalogue ever
 * stops marking any tier as offline-capable.
 */
export function offlinePlan(): Plan {
  return PLANS.find((p) => p.offline) ?? PLANS[PLANS.length - 1]!;
}

/**
 * The cheapest plan that includes offline *music* downloads — VIP.
 *
 * Used by the Music tab's upsell so the prompt always names the plan a viewer
 * would actually have to buy for music.
 */
export function musicOfflinePlan(): Plan {
  return PLANS.find((p) => p.musicOffline) ?? PLANS[PLANS.length - 1]!;
}

/**
 * The cheapest plan that includes background play — VIP.
 *
 * Used by the upsell copy so the prompt always names the plan a listener would
 * actually have to buy for background play.
 */
export function backgroundPlayPlan(): Plan {
  return PLANS.find((p) => p.backgroundPlay) ?? PLANS[PLANS.length - 1]!;
}

/** Authoritative price in cents, or null when the plan id is unknown. */
export function planPriceCents(id?: string | null): number | null {
  const plan = planById(id);
  return plan ? Math.round(plan.price * 100) : null;
}
