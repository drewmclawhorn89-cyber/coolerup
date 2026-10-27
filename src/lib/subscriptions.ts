import { useEffect, useState } from "react";

export type Plan = {
  id: string;
  label: string;
  emoji: string;
  /** price in USD per month */
  price: number;
  perks: string[];
};

export const PLANS: Plan[] = [
  { id: "plus", label: "Plus", emoji: "⭐", price: 4.99, perks: ["Ad-free feed", "Plus badge on your profile"] },
  { id: "pro", label: "Pro", emoji: "🚀", price: 9.99, perks: ["Everything in Plus", "Exclusive tops and names", "Priority uploads"] },
  { id: "vip", label: "VIP", emoji: "👑", price: 19.99, perks: ["Everything in Pro", "VIP badge", "Early access to new features"] },
];

export const VENMO_HANDLE = "Samantha-Barnes-168";

export function venmoUrl(plan: Plan, handle?: string | null) {
  const note = encodeURIComponent(`Coolerup ${plan.label} subscription${handle ? ` (@${handle})` : ""}`);
  return `https://venmo.com/${VENMO_HANDLE}?txn=pay&amount=${plan.price.toFixed(2)}&note=${note}`;
}

const key = (handle: string) => `subscription:${handle}`;
const EVT = "subscription-change";

export function getSubscription(handle?: string | null): string | null {
  if (!handle || typeof window === "undefined") return null;
  return localStorage.getItem(key(handle));
}

// Payments go through Venmo, which does not report back to the app, so a plan
// is stored as "pending" ("pending:<planId>") until the owner confirms payment.
export function subscribe(handle: string, planId: string) {
  localStorage.setItem(key(handle), `pending:${planId}`);
  window.dispatchEvent(new Event(EVT));
}

export function cancelSubscription(handle: string) {
  localStorage.removeItem(key(handle));
  window.dispatchEvent(new Event(EVT));
}

export function useSubscription(handle?: string | null) {
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setPlan(getSubscription(handle));
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [handle]);
  return plan;
}
