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
   * Whether the plan unlocks offline downloads.
   *
   * Offline mode starts at Pro and carries up to VIP. Plus deliberately does
   * *not* include it — that is the upgrade hook from Plus to Pro. Free accounts
   * and Plus subscribers see a locked toggle with an upgrade prompt. Never
   * write the price into a comment — it goes stale.
   */
  offline: boolean;
};

export const PLANS: Plan[] = [
  {
    id: "plus",
    label: "Plus",
    emoji: "\u2b50",
    price: 7.99,
    perks: ["Ad-free feed", "Plus badge on your profile"],
    offline: false,
  },
  {
    id: "pro",
    label: "Pro",
    emoji: "\ud83d\ude80",
    price: 14.99,
    perks: [
      "Everything in Plus",
      "Offline downloads",
      "Exclusive tops and names",
      "Priority uploads",
    ],
    offline: true,
  },
  {
    id: "vip",
    label: "VIP",
    emoji: "\ud83d\udc51",
    price: 29.99,
    perks: ["Everything in Pro", "Offline downloads", "VIP badge", "Early access to new features"],
    offline: true,
  },
];

export function planById(id?: string | null): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/** True when the plan unlocks offline downloads. */
export function planIncludesOffline(id?: string | null): boolean {
  return Boolean(planById(id)?.offline);
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

/** Authoritative price in cents, or null when the plan id is unknown. */
export function planPriceCents(id?: string | null): number | null {
  const plan = planById(id);
  return plan ? Math.round(plan.price * 100) : null;
}
