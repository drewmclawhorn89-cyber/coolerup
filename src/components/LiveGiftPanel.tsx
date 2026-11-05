import { useState } from "react";
import { Coins, Loader2, Send, Sparkles, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import {
  GIFT_COUNTS,
  canAfford,
  giftTotal,
  type GiftCount,
  type LiveGift,
} from "@/lib/coins";

const gifts: LiveGift[] = [
  { id: "rose", name: "Rose", emoji: "🌹", coins: 1, kind: "fly", color: "#fe2c55" },
  { id: "lion", name: "Lion", emoji: "🦁", coins: 100, kind: "burst", color: "#f59e0b" },
];

/**
 * The LIVE gift sheet: a half-screen dark panel that slides up from the bottom,
 * exactly like TikTok's gift tray.
 *
 * Purely presentational — the parent owns sending so it can also broadcast the
 * gift to viewers and play the animation.
 */
export function LiveGiftPanel({
  open,
  onOpenChange,
  balance,
  signedIn,
  sending,
  onSend,
  onRecharge,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Retained for compatibility with callers; this panel always shows Rose and Lion. */
  christmas: boolean;
  balance: number | null;
  signedIn: boolean;
  sending: boolean;
  onSend: (gift: LiveGift, quantity: GiftCount) => void;
  onRecharge: () => void;
  onSignIn: () => void;
}) {
  const [giftId, setGiftId] = useState("rose");
  const [quantity, setQuantity] = useState<GiftCount>(1);

  const selected = gifts.find((gift) => gift.id === giftId) ?? gifts[0] ?? LIVE_GIFTS[0]!;
  const total = giftTotal(selected, quantity);
  const affordable = canAfford(balance, total);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="h-[56dvh] max-h-[34rem] border-t border-white/10 bg-black/95 text-white backdrop-blur-xl focus:outline-none"
        aria-describedby={undefined}
      >
        <DrawerTitle className="sr-only">Send a LIVE gift</DrawerTitle>
        <DrawerDescription className="sr-only">
          Pick a gift, choose how many, and send it to the streamer.
        </DrawerDescription>

        <div className="flex h-full flex-col px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
          {/* Grab handle */}
          <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/25" />

          {/* Wallet header */}
          <div className="flex shrink-0 items-center justify-between gap-3 pb-3">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-sm font-extrabold">
                <Coins className="h-4 w-4 text-yellow-400" />
                Your coins:{" "}
                <span className="text-yellow-400" data-testid="gift-panel-balance">
                  {balance == null ? "—" : balance.toLocaleString()}
                </span>{" "}
                🪙
              </p>
              <p className="mt-0.5 text-[11px] text-white/50">
                {signedIn ? "100 free coins on every new account" : "Sign in to send gifts"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                if (!signedIn) {
                  onSignIn();
                  return;
                }
                onRecharge();
              }}
              className="shrink-0 rounded-full bg-[#fe2c55] px-4 py-2 text-xs font-extrabold text-white transition active:scale-95"
            >
              Recharge
            </button>
          </div>

          {/* Gift grid */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="grid grid-cols-4 gap-2 pb-2">
              {gifts.map((gift) => {
                const active = gift.id === selected.id;
                return (
                  <button
                    key={gift.id}
                    type="button"
                    onClick={() => setGiftId(gift.id)}
                    aria-pressed={active}
                    aria-label={`${gift.name}, ${gift.coins} coins`}
                    className={`relative flex flex-col items-center gap-1 rounded-2xl border p-2 transition active:scale-95 ${
                      active
                        ? "border-[#fe2c55] bg-[#fe2c55]/15"
                        : "border-white/10 bg-white/5 hover:bg-white/10"
                    }`}
                  >
                    <span
                      className={`text-2xl leading-none ${active ? "gift-preview" : ""}`}
                      style={{ filter: `drop-shadow(0 0 8px ${gift.color}66)` }}
                    >
                      {gift.emoji}
                    </span>
                    <span className="w-full truncate text-[10px] font-semibold text-white/80">
                      {gift.name}
                    </span>
                    <span className="flex items-center gap-0.5 text-[10px] font-extrabold text-yellow-400">
                      {gift.coins.toLocaleString()} 🪙
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Quantity + send */}
          <div className="shrink-0 space-y-3 border-t border-white/10 pt-3">
            <div className="flex items-center gap-2">
              <div
                className="flex rounded-full bg-white/10 p-1"
                role="group"
                aria-label="Gift quantity"
              >
                {GIFT_COUNTS.map((count) => (
                  <button
                    key={count}
                    type="button"
                    onClick={() => setQuantity(count)}
                    aria-pressed={quantity === count}
                    className={`min-w-11 rounded-full px-3 py-1.5 text-xs font-extrabold transition ${
                      quantity === count ? "bg-white text-black" : "text-white/70"
                    }`}
                  >
                    x{count}
                  </button>
                ))}
              </div>
              <p className="ml-auto flex items-center gap-1 text-xs font-bold text-white/60">
                <Sparkles className="h-3.5 w-3.5 text-yellow-400" />
                {total.toLocaleString()} 🪙
              </p>
            </div>

            {!affordable && signedIn ? (
              <button
                type="button"
                onClick={onRecharge}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-yellow-400 py-3.5 text-sm font-extrabold text-black transition active:scale-[0.99]"
              >
                Not enough coins — Recharge
              </button>
            ) : (
              <button
                type="button"
                disabled={sending || !signedIn}
                onClick={() => onSend(selected, quantity)}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-[#fe2c55] py-3.5 text-sm font-extrabold text-white transition active:scale-[0.99] disabled:opacity-50"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {signedIn ? `Send ${selected.name}` : "Sign in to send"}
              </button>
            )}

            <p className="text-center text-[10px] text-white/40">
              100 coins = 50 diamonds = $0.50 for the streamer. Gifts are non-refundable.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close gifts"
          className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white/70"
        >
          <X className="h-4 w-4" />
        </button>
      </DrawerContent>
    </Drawer>
  );
}
