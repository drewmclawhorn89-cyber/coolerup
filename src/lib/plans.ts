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
   * Offline mode is a paid feature: it starts with Plus ($4.99) and every
   * higher tier inherits it, because Pro and VIP both include "everything in
   * Plus". Free accounts get a locked toggle with an upgrade prompt.
   */
  offline: boolean;
};

/** Every plan gets the same 7 day free trial. */
export const TRIAL_DAYS = 7;

export const PLANS: Plan[] = [
  {
    id: "plus",
    label: "Plus",
    emoji: "\u2b50",
    price: 4.99,
    perks: ["Ad-free feed", "Plus badge on your profile", "Offline downloads"],
    offline: true,
  },
  {
    id: "pro",
    label: "Pro",
    emoji: "\ud83d\ude80",
    price: 9.99,
    perks: ["Everything in Plus", "Exclusive tops and names", "Priority uploads"],
    offline: true,
  },
  {
    id: "vip",
    label: "VIP",
    emoji: "\ud83d\udc51",
    price: 19.99,
    perks: ["Everything in Pro", "VIP badge", "Early access to new features"],
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

/** The cheapest plan that unlocks offline mode, used by upgrade prompts. */
export function offlinePlan(): Plan {
  return PLANS.find((p) => p.offline) ?? PLANS[0]!;
}

/** Authoritative price in cents, or null when the plan id is unknown. */
export function planPriceCents(id?: string | null): number | null {
  const plan = planById(id);
  return plan ? Math.round(plan.price * 100) : null;
}
