import { useEffect, useState } from "react";
import { ArrowUpRight, Coins, CreditCard, Loader2, ShieldCheck, Wallet, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { COIN_PACKS, usdFromCents } from "@/lib/coins";
import {
  coinPaymentStatus,
  createCoinCheckout,
  createCoinVenmoOrder,
  type CoinPaymentStatus,
  type CoinVenmoOrderResult,
} from "@/lib/coins.functions";

type ReadyOrder = Extract<CoinVenmoOrderResult, { ok: true }>;

/**
 * Buy coins without leaving a LIVE stream.
 *
 * Venmo is the primary rail: tapping a pack creates a real order on the server
 * (with a unique reference code) and hands the payload back to the parent, which
 * opens the Venmo payment sheet on top of this one. Card checkout stays as a
 * fallback when Stripe is configured, and a clear message is shown when neither
 * rail is set up.
 */
export function LiveCoinSheet({
  open,
  onOpenChange,
  balance,
  signedIn,
  onOrderCreated,
  onSignIn,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  balance: number | null;
  signedIn: boolean;
  onOrderCreated: (order: ReadyOrder) => void;
  onSignIn: () => void;
}) {
  const [status, setStatus] = useState<CoinPaymentStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoadingStatus(true);
    coinPaymentStatus()
      .then((next) => {
        if (alive) setStatus(next);
      })
      .catch(() => {
        if (alive) setStatus(null);
      })
      .finally(() => {
        if (alive) setLoadingStatus(false);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  const venmoReady = Boolean(status?.venmoConfigured && status.venmoRecipient);
  const cardReady = Boolean(status?.stripeConfigured);
  const recipient = status?.venmoRecipient ?? null;

  async function buy(packId: string) {
    if (!signedIn) {
      onSignIn();
      return;
    }
    setBuying(packId);
    try {
      if (venmoReady) {
        const result = await createCoinVenmoOrder({ data: { packId } });
        if (!result.ok) {
          toast.error(result.message);
          return;
        }
        onOrderCreated(result);
        return;
      }

      if (cardReady) {
        const result = await createCoinCheckout({ data: { packId } });
        if (result.ok) {
          window.location.assign(result.url);
          return;
        }
        toast.error(result.message);
        return;
      }

      toast.error("Coin purchases aren't set up yet");
    } catch {
      toast.error("Couldn't start that purchase");
    } finally {
      setBuying(null);
    }
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="max-h-[82dvh] border-t border-white/10 bg-black/95 text-white backdrop-blur-xl focus:outline-none"
        aria-describedby={undefined}
      >
        <DrawerTitle className="sr-only">Buy coins</DrawerTitle>
        <DrawerDescription className="sr-only">
          Buy a coin pack with Venmo without leaving the LIVE stream.
        </DrawerDescription>

        <div className="mx-auto mb-2 h-1 w-10 shrink-0 rounded-full bg-white/25" />

        <div className="overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 font-display text-2xl font-extrabold">
                <Coins className="h-5 w-5 text-yellow-400" /> Buy coins
              </p>
              <p className="mt-0.5 text-sm text-white/60">
                Your balance:{" "}
                <span className="font-extrabold text-yellow-400">
                  {balance == null ? "\u2014" : balance.toLocaleString()}
                </span>{" "}
                🪙
              </p>
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Close"
              className="text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => onOpenChange(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {loadingStatus && (
            <p className="mt-4 flex items-center gap-2 text-sm text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Checking payment options…
            </p>
          )}

          {!loadingStatus && status && !venmoReady && !cardReady && (
            <div className="mt-4 rounded-2xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-200">
              Payments aren&apos;t configured on this deployment yet. An admin needs to add{" "}
              <code className="font-mono text-xs">VENMO_RECIPIENT</code> (the Coolerup Venmo
              username) to turn on coin purchases.
            </div>
          )}

          <div className="mt-4 space-y-2">
            {COIN_PACKS.map((pack) => (
              <button
                key={pack.id}
                type="button"
                disabled={buying !== null || (!venmoReady && !cardReady)}
                onClick={() => void buy(pack.id)}
                className="flex w-full items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left transition hover:border-[#fe2c55]/60 hover:bg-white/10 active:scale-[0.99] disabled:opacity-50"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-yellow-400/15 text-yellow-400">
                  <Coins className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-extrabold">
                    {pack.label}
                    {pack.badge && (
                      <span className="rounded-full bg-[#fe2c55] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                        {pack.badge}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-white/55">{usdFromCents(pack.cents)} one-time</span>
                </span>
                {buying === pack.id ? (
                  <Loader2 className="h-5 w-5 animate-spin text-white/60" />
                ) : (
                  <span className="flex items-center gap-1 rounded-full bg-[#fe2c55] px-3 py-1.5 text-xs font-extrabold text-white">
                    Buy
                  </span>
                )}
              </button>
            ))}
          </div>

          {venmoReady && recipient && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/50">
              <Wallet className="h-3.5 w-3.5 text-[#3d95ce]" /> Pay with Venmo to{" "}
              <span className="font-bold text-white/80">@{recipient}</span>
            </p>
          )}

          {!venmoReady && cardReady && (
            <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-white/50">
              <CreditCard className="h-3.5 w-3.5" /> Card checkout is available on this deployment
            </p>
          )}

          <p className="mt-4 flex items-start gap-2 rounded-2xl bg-white/5 p-3 text-xs text-white/55">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
            {venmoReady
              ? "You send the exact amount to the Coolerup Venmo account with a short order code in the note. Coins land once the payment is matched \u2014 usually within a few hours."
              : "Coins are added after your payment is confirmed."}
          </p>

          <p className="mt-3 text-center text-[10px] text-white/35">
            100 coins = 50 diamonds = $0.50 for the streamer. Gifts are non-refundable.
          </p>

          {venmoReady && (
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                window.open("https://venmo.com", "_blank", "noreferrer");
              }}
              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-full border border-white/10 py-2.5 text-xs font-bold text-white/60"
            >
              Open Venmo <ArrowUpRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
