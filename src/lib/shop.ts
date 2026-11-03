import { useEffect, useState } from "react";

export type ShopItem = {
  id: string;
  kind: "top" | "name" | "animal";
  label: string;
  emoji: string;
  /** number of posts needed to unlock */
  need: number;
  className: string;
};

export const SHOP_ITEMS: ShopItem[] = [
  { id: "top-tee", kind: "top", label: "Classic Tee", emoji: "👕", need: 0, className: "ring-4 ring-sky-400" },
  { id: "top-hoodie", kind: "top", label: "Cozy Hoodie", emoji: "🧥", need: 1, className: "ring-4 ring-purple-500" },
  { id: "top-jersey", kind: "top", label: "Star Jersey", emoji: "🏀", need: 3, className: "ring-4 ring-orange-500" },
  { id: "top-crown", kind: "top", label: "Golden Crown", emoji: "👑", need: 10, className: "ring-4 ring-yellow-400" },
  { id: "name-plain", kind: "name", label: "Plain", emoji: "🔤", need: 0, className: "" },
  { id: "name-neon", kind: "name", label: "Neon Name", emoji: "💡", need: 2, className: "text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.9)]" },
  { id: "name-fire", kind: "name", label: "Fire Name", emoji: "🔥", need: 5, className: "text-orange-500 drop-shadow-[0_0_6px_rgba(249,115,22,0.9)]" },
  { id: "name-gold", kind: "name", label: "Gold Name", emoji: "✨", need: 10, className: "text-yellow-400 drop-shadow-[0_0_6px_rgba(250,204,21,0.9)]" },
  { id: "animal-cat", kind: "animal", label: "Cat", emoji: "🐱", need: 10, className: "" },
  { id: "animal-dog", kind: "animal", label: "Dog", emoji: "🐶", need: 20, className: "" },
  { id: "animal-fox", kind: "animal", label: "Fox", emoji: "🦊", need: 30, className: "" },
  { id: "animal-panda", kind: "animal", label: "Panda", emoji: "🐼", need: 40, className: "" },
  { id: "animal-bunny", kind: "animal", label: "Bunny", emoji: "🐰", need: 50, className: "" },
  { id: "animal-lion", kind: "animal", label: "Lion", emoji: "🦁", need: 60, className: "" },
  { id: "animal-unicorn", kind: "animal", label: "Unicorn", emoji: "🦄", need: 70, className: "" },
  { id: "animal-dragon", kind: "animal", label: "Dragon", emoji: "🐉", need: 80, className: "" },
];

export type Equipped = { top?: string; name?: string; animal?: string };
const key = (handle: string) => `shop-equipped:${handle}`;
const EVT = "shop-change";

export function getEquipped(handle?: string | null): Equipped {
  if (!handle || typeof window === "undefined") return {};
  try { return JSON.parse(localStorage.getItem(key(handle)) || "{}"); } catch { return {}; }
}

export function equip(handle: string, item: ShopItem | null, kind: ShopItem["kind"]) {
  const cur = getEquipped(handle);
  cur[kind] = item?.id as string;
  localStorage.setItem(key(handle), JSON.stringify(cur));
  window.dispatchEvent(new Event(EVT));
}

export function useEquipped(handle?: string | null) {
  const [eq, setEq] = useState<Equipped>({});
  useEffect(() => {
    const sync = () => setEq(getEquipped(handle));
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [handle]);
  return eq;
}

export const findItem = (id?: string) => SHOP_ITEMS.find((i) => i.id === id);

/* -------------------------------------------------------------------------- */
/*  Free trials                                                               */
/* -------------------------------------------------------------------------- */

export type ShopPerk = {
  id: string;
  /** Brand name shown on the card. */
  label: string;
  /** One-line pitch under the name. */
  blurb: string;
  emoji: string;
  /** Length of the free trial, in days. */
  days: number;
  /** Where the user finishes signup to activate the trial. */
  url: string;
  /** Tailwind gradient classes for the card face. */
  face: string;
};

export const SHOP_PERKS: ShopPerk[] = [
  {
    id: "hulu-trial",
    label: "Hulu",
    blurb: "30 days free. Cancel anytime.",
    emoji: "\u{1F4FA}",
    days: 30,
    url: "https://www.hulu.com/",
    face: "from-[#1ce783] via-[#12a866] to-[#053b2a]",
  },
];

const perkKey = (handle: string) => `shop-perks:${handle}`;

/** Ids of the perks this account has already claimed. */
export function getClaimedPerks(handle?: string | null): string[] {
  if (!handle || typeof window === "undefined") return [];
  try {
    const raw = JSON.parse(localStorage.getItem(perkKey(handle)) || "[]");
    return Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

export function hasClaimedPerk(handle: string | null | undefined, perkId: string): boolean {
  return getClaimedPerks(handle).includes(perkId);
}

/** Claims a perk once per account. Returns false when it was already claimed. */
export function claimPerk(handle: string, perkId: string): boolean {
  const claimed = getClaimedPerks(handle);
  if (claimed.includes(perkId)) return false;
  localStorage.setItem(perkKey(handle), JSON.stringify([...claimed, perkId]));
  window.dispatchEvent(new Event(EVT));
  return true;
}

export function useClaimedPerks(handle?: string | null) {
  const [claimed, setClaimed] = useState<string[]>([]);
  useEffect(() => {
    const sync = () => setClaimed(getClaimedPerks(handle));
    sync();
    window.addEventListener(EVT, sync);
    return () => window.removeEventListener(EVT, sync);
  }, [handle]);
  return claimed;
}
