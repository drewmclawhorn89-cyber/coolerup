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
};

export const PLANS: Plan[] = [
  {
    id: "plus",
    label: "Plus",
    emoji: "\u2b50",
    price: 7.99,
    perks: ["Ad-free feed", "Plus badge on your profile"],
  },
  {
    id: "pro",
    label: "Pro",
    emoji: "\ud83d\ude80",
    price: 14.99,
    perks: ["Everything in Plus", "Exclusive tops and names", "Priority uploads"],
  },
  {
    id: "vip",
    label: "VIP",
    emoji: "\ud83d\udc51",
    price: 29.99,
    perks: ["Everything in Pro", "VIP badge", "Early access to new features"],
  },
];

export function planById(id?: string | null): Plan | undefined {
  return PLANS.find((p) => p.id === id);
}

/**
 * Offline downloads are free for everyone, so no plan gates them.
 *
 * Kept as a function (rather than deleted) because the offline library and
 * the download buttons still ask "may this viewer save videos?" and the
 * answer is now always yes, regardless of plan or sign-in state.
 */
export function planIncludesOffline(_id?: string | null): boolean {
  return true;
}

/** Authoritative price in cents, or null when the plan id is unknown. */
export function planPriceCents(id?: string | null): number | null {
  const plan = planById(id);
  return plan ? Math.round(plan.price * 100) : null;
}
