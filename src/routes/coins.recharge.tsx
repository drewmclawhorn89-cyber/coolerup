import { useEffect, useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Coins, Loader2, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { COIN_PACKS, notifyCoinsChanged, usdFromCents, useCoins } from "@/lib/coins";
import { coinPaymentStatus, confirmCoinPurchase, createCoinCheckout } from "@/lib/coins.functions";

export const Route = createFileRoute("/coins/recharge")({
  head: () => ({
    meta: [
      { title: "Recharge coins — Coolerup" },
      { name: "description", content: "Buy Coolerup coins to send LIVE gifts." },
    ],
  }),
  component: RechargePage,
});

/**
 * Real coin purchases through Stripe Checkout.
 *
 * Stripe hosts the card form, so Coolerup never sees a card number. When Stripe
 * redirects back with ?session_id=..., the server verifies the session with
 * Stripe before any coins are credited.
 */
function RechargePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const wallet = useCoins(auth.user?.id);
  const [stripeReady, setStripeReady] = useState<boolean | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const params = useMemo(
    () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const sessionId = params.get("session_id");
  const canceled = params.get("canceled");

  useEffect(() => {
    let alive = true;
    coinPaymentStatus()
      .then((status) => {
        if (alive) setStripeReady(status.stripeConfigured);
      })
      .catch(() => {
        if (alive) setStripeReady(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (canceled) toast.message("Checkout canceled — no coins were bought");
  }, [canceled]);

  const setWalletBalance = wallet.setBalance;
  const userId = auth.user?.id;

  useEffect(() => {
    if (!sessionId || !userId) return;
    let alive = true;
    setConfirming(true);
    confirmCoinPurchase({ data: { sessionId } })
      .then((result) => {
        if (!alive) return;
        if (result.ok) {
          toast.success(
            result.alreadyCredited
              ? `Already added — you have ${result.balance.toLocaleString()} coins`
              : `+${result.coins.toLocaleString()} coins added`,
          );
          setWalletBalance(result.balance);
          notifyCoinsChanged();
          void navigate({ to: "/coins/recharge", replace: true });
        } else {
          toast.error(result.message);
        }
      })
      .catch(() => {
        if (alive) toast.error("Couldn't confirm that payment");
      })
      .finally(() => {
        if (alive) setConfirming(false);
      });
    return () => {
      alive = false;
    };
  }, [sessionId, userId, navigate, setWalletBalance]);

  async function buy(packId: string) {
    if (!auth.user) {
      auth.signIn();
      return;
    }
    setBuying(packId);
    try {
      const result = await createCoinCheckout({ data: { packId } });
      if (result.ok) {
        window.location.assign(result.url);
        return;
      }
      toast.error(result.message);
    } catch {
      toast.error("Couldn't start checkout");
    } finally {
      setBuying(null);
    }
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeft />
        </Button>
        <h1 className="font-display text-lg font-extrabold">Recharge coins</h1>
      </header>

      <div className="space-y-5 px-4 pt-4">
        <section className="rounded-3xl bg-gradient-to-br from-[#fe2c55] to-[#7a1030] p-5 text-white shadow-lg">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">
            Your balance
          </p>
          <p className="mt-1 flex items-baseline gap-2 font-display text-4xl font-extrabold">
            {wallet.balance == null ? "—" : wallet.balance.toLocaleString()}
            <span className="text-xl">🪙</span>
          </p>
          <p className="mt-2 text-xs text-white/75">
            {auth.user
              ? "Coins never expire. 100 coins = 50 diamonds for the streamer."
              : "Sign in to buy coins."}
          </p>
        </section>

        {confirming && (
          <div className="flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-sm font-bold">
            <Loader2 className="h-4 w-4 animate-spin" /> Confirming your payment…
          </div>
        )}

        {stripeReady === false && (
          <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-900 dark:text-yellow-200">
            Card payments aren&apos;t configured on this deployment yet. Add{" "}
            <code className="font-mono text-xs">STRIPE_SECRET_KEY</code> to enable real charging.
          </div>
        )}

        <section className="space-y-3">
          {COIN_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              disabled={buying !== null}
              onClick={() => void buy(pack.id)}
              className="flex w-full items-center gap-4 rounded-2xl border bg-card p-4 text-left transition hover:border-[#fe2c55]/60 hover:bg-secondary disabled:opacity-60"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-yellow-400/15 text-yellow-500">
                <Coins className="h-6 w-6" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 font-extrabold">
                  {pack.label}
                  {pack.badge && (
                    <span className="rounded-full bg-[#fe2c55] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                      {pack.badge}
                    </span>
                  )}
                </span>
                <span className="text-sm text-muted-foreground">
                  {usdFromCents(pack.cents)} one-time
                </span>
              </span>
              {buying === pack.id ? (
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              ) : (
                <span className="rounded-full bg-[#fe2c55] px-4 py-2 text-xs font-extrabold text-white">
                  Buy
                </span>
              )}
            </button>
          ))}
        </section>

        <section className="rounded-2xl bg-secondary p-4 text-sm text-muted-foreground">
          <p className="mb-2 flex items-center gap-2 font-bold text-foreground">
            <Lock className="h-4 w-4" /> Secure checkout
          </p>
          <ul className="space-y-1.5">
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> Payments are handled by
              Stripe — card details never touch Coolerup.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> Coins are added the
              moment Stripe confirms the payment.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> You must be 13+ to buy
              coins.
            </li>
          </ul>
        </section>

        <section className="rounded-2xl border border-dashed p-4 text-sm">
          <p className="flex items-center gap-2 font-bold">
            <Sparkles className="h-4 w-4 text-[#fe2c55]" /> Sending gifts
          </p>
          <p className="mt-1 text-muted-foreground">
            Open any LIVE stream and tap the pink 🎁 button. Coins are deducted when the gift sends,
            and the streamer earns diamonds at 100 coins = 50 diamonds = $0.50.
          </p>
        </section>
      </div>
    </div>
  );
}
