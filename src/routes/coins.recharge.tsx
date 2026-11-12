import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Check, Coins, CreditCard, Loader2, Lock, Sparkles, Wallet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CoinVenmoSheet } from "@/components/CoinVenmoSheet";
import { VenmoFreeCoins } from "@/components/VenmoFreeCoins";
import { useAuth } from "@/hooks/useAuth";
import { COIN_PACKS, notifyCoinsChanged, usdFromCents, useCoins } from "@/lib/coins";
import {
  coinPaymentStatus,
  confirmCoinPurchase,
  createCoinCheckout,
  createCoinVenmoOrder,
  myCoinVenmoOrders,
  type CoinPaymentStatus,
  type CoinVenmoOrderResult,
  type VenmoOrderRow,
} from "@/lib/coins.functions";
import {
  amountString,
  buildVenmoNote,
  isVenmoOrderOpen,
  venmoAppUrl,
  venmoPayUrl,
  venmoStatusLabel,
  venmoStatusTone,
} from "@/lib/venmo";

export const Route = createFileRoute("/coins/recharge")({
  head: () => ({
    meta: [
      { title: "Recharge coins — Coolerup" },
      { name: "description", content: "Buy Coolerup coins to send LIVE gifts." },
    ],
  }),
  component: RechargePage,
});

type ReadyOrder = Extract<CoinVenmoOrderResult, { ok: true }>;

/** Rebuild a sheet payload from a stored order so "try again" works. */
function orderFromRow(row: VenmoOrderRow, recipient: string): ReadyOrder {
  const link = {
    handle: recipient,
    cents: row.amount_cents,
    referenceCode: row.reference_code,
  };
  return {
    ok: true,
    orderId: row.id,
    referenceCode: row.reference_code,
    amountCents: row.amount_cents,
    amountUsd: amountString(row.amount_cents),
    note: buildVenmoNote(row.reference_code),
    recipient,
    venmoUrl: venmoPayUrl(link),
    appUrl: venmoAppUrl(link),
  };
}

const TONE_CLASS: Record<string, string> = {
  pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-300",
  good: "bg-green-500/15 text-green-700 dark:text-green-300",
  bad: "bg-destructive/15 text-destructive",
  muted: "bg-muted text-muted-foreground",
};

/**
 * Coin purchases.
 *
 * Venmo is the primary rail: the buyer gets an order code, sends money to the
 * Coolerup Venmo account with that code in the note, and an admin approves the
 * order. Card checkout stays available when STRIPE_SECRET_KEY is configured.
 */
function RechargePage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const wallet = useCoins(auth.user?.id);
  const [payStatus, setPayStatus] = useState<CoinPaymentStatus | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [orders, setOrders] = useState<VenmoOrderRow[]>([]);
  const [activeOrder, setActiveOrder] = useState<ReadyOrder | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const seenPaid = useRef<Set<string>>(new Set());

  const params = useMemo(
    () =>
      typeof window === "undefined"
        ? new URLSearchParams()
        : new URLSearchParams(window.location.search),
    [],
  );
  const sessionId = params.get("session_id");
  const canceled = params.get("canceled");

  const userId = auth.user?.id;
  const recipient = payStatus?.venmoRecipient ?? null;
  const venmoReady = Boolean(payStatus?.venmoConfigured && recipient);
  const cardReady = Boolean(payStatus?.stripeConfigured);

  useEffect(() => {
    let alive = true;
    coinPaymentStatus()
      .then((status) => {
        if (alive) setPayStatus(status);
      })
      .catch(() => {
        if (alive) setPayStatus(null);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (canceled) toast.message("Checkout canceled — no coins were bought");
  }, [canceled]);

  const refreshOrders = useCallback(async () => {
    if (!userId) {
      setOrders([]);
      return;
    }
    try {
      const rows = await myCoinVenmoOrders();
      setOrders(rows);
    } catch {
      // A failed poll shouldn't wipe the list or shout at the user.
    }
  }, [userId]);

  useEffect(() => {
    void refreshOrders();
  }, [refreshOrders]);

  // Announce a freshly approved order once, then refresh the wallet.
  useEffect(() => {
    let gained = false;
    for (const order of orders) {
      if (order.status !== "paid") continue;
      if (seenPaid.current.has(order.id)) continue;
      seenPaid.current.add(order.id);
      gained = true;
      toast.success(`+${order.coins.toLocaleString()} coins added`);
    }
    if (gained) {
      notifyCoinsChanged();
      void wallet.refresh();
    }
  }, [orders, wallet]);

  const hasOpenOrder = orders.some((o) => isVenmoOrderOpen(o.status));

  useEffect(() => {
    if (!userId || !hasOpenOrder) return;
    const timer = setInterval(() => void refreshOrders(), 8000);
    return () => clearInterval(timer);
  }, [userId, hasOpenOrder, refreshOrders]);

  const setWalletBalance = wallet.setBalance;

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

  function requireSignIn(): boolean {
    if (auth.user) return true;
    auth.signIn();
    return false;
  }

  async function startVenmo(packId: string) {
    if (!requireSignIn()) return;
    setBuying(packId);
    try {
      const result = await createCoinVenmoOrder({ data: { packId } });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setActiveOrder(result);
      setSheetOpen(true);
      void refreshOrders();
    } catch {
      toast.error("Couldn't start that order");
    } finally {
      setBuying(null);
    }
  }

  async function buyWithCard(packId: string) {
    if (!requireSignIn()) return;
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

  function resumeOrder(row: VenmoOrderRow) {
    if (!recipient) return;
    setActiveOrder(orderFromRow(row, recipient));
    setSheetOpen(true);
  }

  const visibleOrders = orders.filter((o) => o.status !== "canceled").slice(0, 5);

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

        <section className="rounded-3xl border border-[#3D95CE]/30 bg-[#3D95CE]/5 p-4">
          <h2 className="mb-2 text-sm font-extrabold">Free coins</h2>
          <VenmoFreeCoins />
        </section>

        {confirming && (
          <div className="flex items-center gap-2 rounded-2xl bg-secondary px-4 py-3 text-sm font-bold">
            <Loader2 className="h-4 w-4 animate-spin" /> Confirming your payment…
          </div>
        )}

        {payStatus && !venmoReady && !cardReady && (
          <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 px-4 py-3 text-sm text-yellow-900 dark:text-yellow-200">
            Payments aren&apos;t configured on this deployment yet. Add{" "}
            <code className="font-mono text-xs">VENMO_RECIPIENT</code> (the Coolerup Venmo username)
            to turn on coin purchases.
          </div>
        )}

        <section className="space-y-3">
          {COIN_PACKS.map((pack) => (
            <button
              key={pack.id}
              type="button"
              disabled={buying !== null}
              onClick={() => void (venmoReady ? startVenmo(pack.id) : buyWithCard(pack.id))}
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

        {venmoReady && recipient && (
          <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Wallet className="h-3.5 w-3.5 text-[#3d95ce]" /> Paid with Venmo to{" "}
            <span className="font-bold text-foreground">@{recipient}</span>
          </p>
        )}

        {cardReady && (
          <section className="rounded-2xl border border-dashed p-4">
            <p className="flex items-center gap-2 text-sm font-bold">
              <CreditCard className="h-4 w-4" /> Prefer a card?
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Card checkout is live on this deployment.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {COIN_PACKS.map((pack) => (
                <Button
                  key={pack.id}
                  size="sm"
                  variant="secondary"
                  disabled={buying !== null}
                  onClick={() => void buyWithCard(pack.id)}
                >
                  {pack.coins.toLocaleString()} · {usdFromCents(pack.cents)}
                </Button>
              ))}
            </div>
          </section>
        )}

        {visibleOrders.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-sm font-extrabold">Your orders</h2>
            {visibleOrders.map((order) => {
              const tone = venmoStatusTone(order.status);
              const canRetry = order.status === "rejected" && venmoReady;
              return (
                <article key={order.id} className="rounded-xl border border-border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="font-mono text-sm font-bold">{order.reference_code}</code>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        TONE_CLASS[tone] ?? TONE_CLASS["muted"]
                      }`}
                    >
                      {venmoStatusLabel(order.status)}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {order.coins.toLocaleString()} coins · {usdFromCents(order.amount_cents)}
                    </span>
                  </div>
                  {order.admin_note && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Admin: “{order.admin_note}”
                    </p>
                  )}
                  {canRetry && (
                    <Button
                      size="sm"
                      variant="secondary"
                      className="mt-2"
                      onClick={() => resumeOrder(order)}
                    >
                      Send payment details again
                    </Button>
                  )}
                </article>
              );
            })}
            {hasOpenOrder && (
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Checking for your payment…
              </p>
            )}
          </section>
        )}

        <section className="rounded-2xl bg-secondary p-4 text-sm text-muted-foreground">
          <p className="mb-2 flex items-center gap-2 font-bold text-foreground">
            <Lock className="h-4 w-4" /> How buying works
          </p>
          <ul className="space-y-1.5">
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> Pay with Venmo — you send
              the exact amount and an order code, so nothing is guessed.
            </li>
            <li className="flex gap-2">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-500" /> Coins are added once the
              payment is matched, usually within a few hours.
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

      <CoinVenmoSheet
        order={activeOrder}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSubmitted={() => void refreshOrders()}
      />
    </div>
  );
}
