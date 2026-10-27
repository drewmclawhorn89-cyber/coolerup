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

const key = (handle: string) => `subscription:${handle}`;
const EVT = "subscription-change";

export function getSubscription(handle?: string | null): string | null {
  if (!handle || typeof window === "undefined") return null;
  return localStorage.getItem(key(handle));
}

// NOTE: no payment provider is connected yet; this only records the chosen plan locally.
export function subscribe(handle: string, planId: string) {
  localStorage.setItem(key(handle), planId);
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
