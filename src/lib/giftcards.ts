/**
 * Gift card catalogue.
 *
 * These are real, redeemable gift cards from real retailers. The shop shows the
 * brand, the fixed denominations that brand actually sells, and the delivery
 * email the code gets sent to.
 *
 * IMPORTANT: prices live here (not in the UI) and are re-checked on the server
 * before a card is charged, so a tampered client cannot buy a $100 card for $1.
 * Keep this file free of React and browser APIs so the server can import it.
 */

export type GiftCardBrand = {
  /** Stable id used in orders and by the fulfilment provider. */
  id: string;
  /** Retailer name as it appears on the card. */
  name: string;
  /** Short line shown under the name. */
  blurb: string;
  /** Emoji stand-in for the logo (works offline, no trademark assets). */
  emoji: string;
  /** Tailwind gradient classes for the card face. */
  face: string;
  /** Denominations the retailer actually sells, in whole dollars. */
  amounts: number[];
  /** Categories used by the shop filter chips. */
  tags: GiftCardTag[];
  /** Provider product id (Tremendous / Tango style slug). */
  providerProductId: string;
};

export type GiftCardTag = "all" | "shopping" | "gaming" | "streaming" | "food" | "prepaid";

export const GIFT_CARD_TAGS: { id: GiftCardTag; label: string }[] = [
  { id: "all", label: "All" },
  { id: "shopping", label: "Shopping" },
  { id: "gaming", label: "Gaming" },
  { id: "streaming", label: "Streaming" },
  { id: "food", label: "Food & drink" },
  { id: "prepaid", label: "Prepaid" },
];

export const GIFT_CARDS: GiftCardBrand[] = [
  {
    id: "amazon",
    name: "Amazon",
    blurb: "Millions of items, one code",
    emoji: "📦",
    face: "from-orange-500 via-amber-500 to-yellow-400",
    amounts: [10, 25, 50, 100, 200],
    tags: ["shopping"],
    providerProductId: "amazon-us",
  },
  {
    id: "apple",
    name: "Apple",
    blurb: "Apps, games, music and iCloud",
    emoji: "",
    face: "from-neutral-700 via-neutral-900 to-black",
    amounts: [10, 15, 25, 50, 100],
    tags: ["shopping", "streaming"],
    providerProductId: "apple-us",
  },
  {
    id: "google-play",
    name: "Google Play",
    blurb: "Apps, games, films and books",
    emoji: "▶",
    face: "from-sky-500 via-emerald-500 to-yellow-400",
    amounts: [10, 15, 25, 50, 100],
    tags: ["shopping", "streaming"],
    providerProductId: "google-play-us",
  },
  {
    id: "playstation",
    name: "PlayStation",
    blurb: "PS Store credit and PS Plus",
    emoji: "🎮",
    face: "from-blue-700 via-blue-900 to-slate-900",
    amounts: [10, 25, 50, 100],
    tags: ["gaming"],
    providerProductId: "playstation-us",
  },
  {
    id: "xbox",
    name: "Xbox",
    blurb: "Games, add-ons and Game Pass",
    emoji: "🎮",
    face: "from-green-600 via-emerald-700 to-green-900",
    amounts: [10, 15, 25, 50, 100],
    tags: ["gaming"],
    providerProductId: "xbox-us",
  },
  {
    id: "steam",
    name: "Steam",
    blurb: "Wallet credit for the Steam store",
    emoji: "💻",
    face: "from-slate-700 via-slate-900 to-black",
    amounts: [20, 50, 100],
    tags: ["gaming"],
    providerProductId: "steam-us",
  },
  {
    id: "roblox",
    name: "Roblox",
    blurb: "Robux for avatar gear and games",
    emoji: "🧩",
    face: "from-red-500 via-rose-600 to-red-800",
    amounts: [10, 25, 50],
    tags: ["gaming"],
    providerProductId: "roblox-us",
  },
  {
    id: "netflix",
    name: "Netflix",
    blurb: "Pay for a month of streaming",
    emoji: "🍿",
    face: "from-red-600 via-red-700 to-neutral-900",
    amounts: [25, 50, 100],
    tags: ["streaming"],
    providerProductId: "netflix-us",
  },
  {
    id: "spotify",
    name: "Spotify",
    blurb: "Premium months, no ads",
    emoji: "🎵",
    face: "from-green-500 via-emerald-600 to-green-800",
    amounts: [10, 30, 60],
    tags: ["streaming"],
    providerProductId: "spotify-us",
  },
  {
    id: "starbucks",
    name: "Starbucks",
    blurb: "Coffee runs and cake pops",
    emoji: "☕",
    face: "from-emerald-700 via-green-800 to-emerald-950",
    amounts: [10, 25, 50],
    tags: ["food"],
    providerProductId: "starbucks-us",
  },
  {
    id: "doordash",
    name: "DoorDash",
    blurb: "Delivery from the places you love",
    emoji: "🛵",
    face: "from-red-500 via-rose-600 to-red-900",
    amounts: [15, 25, 50],
    tags: ["food"],
    providerProductId: "doordash-us",
  },
  {
    id: "visa-prepaid",
    name: "Visa Prepaid",
    blurb: "Spend it anywhere Visa is accepted",
    emoji: "💳",
    face: "from-indigo-600 via-blue-700 to-slate-900",
    amounts: [25, 50, 100, 200],
    tags: ["prepaid", "shopping"],
    providerProductId: "visa-prepaid-us",
  },
];

/** Flat service fee added on top of the face value, in cents. */
export const GIFT_CARD_FEE_CENTS = 0;

export const FREE_GIFT_CARD_LIMIT_PER_DAY = 5;

export const FREE_GIFT_CARD_OFFERS = [
  { cardId: "amazon", amount: 10 },
  { cardId: "starbucks", amount: 10 },
  { cardId: "spotify", amount: 10 },
  { cardId: "visa-prepaid", amount: 25 },
] as const;

export function giftCardById(id: string): GiftCardBrand | undefined {
  return GIFT_CARDS.find((c) => c.id === id);
}

/** True when the retailer actually sells that denomination. */
export function isAllowedAmount(card: GiftCardBrand, amount: number): boolean {
  return Number.isInteger(amount) && card.amounts.includes(amount);
}

/**
 * What the buyer is charged, in cents. Computed from the catalogue so the
 * client can display it and the server can verify it.
 */
export function giftCardPriceCents(cardId: string, amount: number): number | null {
  const card = giftCardById(cardId);
  if (!card || !isAllowedAmount(card, amount)) return null;
  return amount * 100 + GIFT_CARD_FEE_CENTS;
}

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/** Masks a code for the order list: keeps the first and last 4 characters. */
export function maskCode(code: string): string {
  const clean = code.trim();
  if (clean.length <= 8) return clean;
  return `${clean.slice(0, 4)}••••${clean.slice(-4)}`;
}

export type GiftCardOrderStatus = "pending" | "delivered" | "failed";

export type GiftCardOrder = {
  id: string;
  card_id: string;
  card_name: string;
  amount_cents: number;
  recipient_email: string;
  status: GiftCardOrderStatus;
  code: string | null;
  redemption_url: string | null;
  created_at: string;
};

function freeGiftCardKey(handle: string): string {
  return `coolerup-free-gift-cards:${handle.toLowerCase()}`;
}

export function getFreeGiftCardClaims(handle?: string | null): Array<{ date: string; cardId: string; amount: number; claimedAt: string }> {
  if (!handle || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(freeGiftCardKey(handle));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function freeGiftCardClaimsRemaining(handle?: string | null): number {
  if (!handle || typeof window === "undefined") return FREE_GIFT_CARD_LIMIT_PER_DAY;
  const today = new Date().toISOString().slice(0, 10);
  const claims = getFreeGiftCardClaims(handle).filter((entry) => entry.date === today);
  return Math.max(0, FREE_GIFT_CARD_LIMIT_PER_DAY - claims.length);
}

export function claimFreeGiftCard(handle: string | null, cardId: string): { card: GiftCardBrand; amount: number; remaining: number } {
  if (!handle || typeof window === "undefined") {
    throw new Error("Sign in to claim a free gift card");
  }

  const card = giftCardById(cardId);
  if (!card) {
    throw new Error("That free gift card is not available");
  }

  const offer = FREE_GIFT_CARD_OFFERS.find((entry) => entry.cardId === cardId);
  if (!offer) {
    throw new Error("That free gift card is not available today");
  }

  const today = new Date().toISOString().slice(0, 10);
  const claims = getFreeGiftCardClaims(handle).filter((entry) => entry.date === today);
  if (claims.length >= FREE_GIFT_CARD_LIMIT_PER_DAY) {
    throw new Error("You've reached the 5 free gift card limit for today.");
  }

  const nextClaims = [...claims, { date: today, cardId, amount: offer.amount, claimedAt: new Date().toISOString() }];
  window.localStorage.setItem(freeGiftCardKey(handle), JSON.stringify(nextClaims));

  return {
    card,
    amount: offer.amount,
    remaining: Math.max(0, FREE_GIFT_CARD_LIMIT_PER_DAY - nextClaims.length),
  };
}
