import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, Gift, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PaymentMethodForm } from "@/components/PaymentMethodForm";
import {
  HAS_STRIPE,
  googlePayDiagnose,
  requestGooglePay,
  type GooglePayReason,
} from "@/lib/googlepay";
import { giftCardStatus, purchaseGiftCard, reserveGiftCardOrder } from "@/lib/giftcards.functions";
import {
  formatUsd,
  giftCardPriceCents,
  isEmail,
  type GiftCardBrand,
  type GiftCardOrder,
} from "@/lib/giftcards";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type Props = {
  /** The card being bought. `null` closes the sheet. */
  card: GiftCardBrand | null;
  handle?: string | null;
  onClose: () => void;
  onPurchased?: (order: GiftCardOrder) => void;
  onSignIn?: () => void;
};

/** The Google "G" mark, drawn inline so it works offline. */
function GoogleG({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#4285F4"
        d="M45.1 24.5c0-1.6-.1-2.8-.4-4.1H24v7.8h12c-.2 2-1.5 5-4.4 7l6.7 5.2c4-3.7 6.8-9.1 6.8-15.9z"
      />
      <path
        fill="#34A853"
        d="M24 46c5.9 0 10.9-1.9 14.5-5.3l-6.9-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.7-3.8-12.5-9.1l-7.1 5.5C8 41.1 15.4 46 24 46z"
      />
      <path
        fill="#FBBC05"
        d="M11.5 28.4c-.5-1.4-.8-2.9-.8-4.4s.3-3 .7-4.4l-7.1-5.5C2.8 17 2 20.4 2 24s.8 7 2.3 9.9l7.2-5.5z"
      />
      <path
        fill="#EA4335"
        d="M24 10.5c4.1 0 6.9 1.8 8.5 3.3l6.1-6C34.9 4.3 29.9 2 24 2 15.4 2 8 6.9 4.3 14.1l7.1 5.5c1.8-5.3 6.7-9.1 12.6-9.1z"
      />
    </svg>
  );
}

function gpayHint(reason: GooglePayReason): string {
  switch (reason) {
    case "script-blocked":
      return "Google Pay couldn't load \u2014 an ad blocker may be blocking pay.google.com. Allow it, then try again.";
    case "no-api":
      return "Google Pay didn't pre-check in this browser. The button still works \u2014 try Chrome or Safari if it won't open.";
    case "no-wallet":
      return "No Google Pay account found on this device. Add a card at pay.google.com, or pay by card below.";
    default:
      return "Google Pay isn't available here \u2014 pay by card below.";
  }
}

/**
 * Gift card checkout.
 *
 * Choose an amount, say where the code should go, then pay. Google Pay returns
 * a gateway token that the server exchanges for a real charge before the code
 * is requested from the fulfilment provider.
 */
export function GiftCardSheet({ card, handle, onClose, onPurchased, onSignIn }: Props) {
  const open = Boolean(card);
  const [amount, setAmount] = useState<number>(0);
  const [email, setEmail] = useState("");
  const [stage, setStage] = useState<"choose" | "card" | "done">("choose");
  const [gpayReady, setGpayReady] = useState(false);
  const [gpayReason, setGpayReason] = useState<GooglePayReason>("no-api");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<GiftCardOrder | null>(null);
  const [providerLive, setProviderLive] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  // Reset for each new card.
  useEffect(() => {
    if (!open || !card) return;
    setAmount(card.amounts[1] ?? card.amounts[0] ?? 25);
    setStage("choose");
    setError(null);
    setOrder(null);
    setBusy(false);
    setCopied(false);
  }, [open, card]);

  // Prefill the delivery email from the signed-in account.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    supabase.auth
      .getUser()
      .then(({ data }) => {
        if (!alive) return;
        const accountEmail = data.user?.email;
        if (accountEmail) setEmail((cur) => cur || accountEmail);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    googlePayDiagnose().then((d) => {
      if (!alive) return;
      setGpayReady(d.ready);
      setGpayReason(d.reason);
    });
    giftCardStatus()
      .then((s) => {
        if (alive) setProviderLive(s.providerConfigured);
      })
      .catch(() => {
        if (alive) setProviderLive(null);
      });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!card) return null;

  const priceCents = giftCardPriceCents(card.id, amount) ?? 0;
  const price = priceCents / 100;
  const emailOk = isEmail(email);

  const finish = (next: GiftCardOrder) => {
    setOrder(next);
    setStage("done");
    onPurchased?.(next);
  };

  const payWithGoogle = async () => {
    setError(null);
    if (!handle) {
      onSignIn?.();
      return;
    }
    if (!emailOk) {
      setError("Enter a valid email so we know where to send the code.");
      return;
    }
    setBusy(true);
    try {
      const result = await requestGooglePay(
        price,
        `${card.name} ${formatUsd(priceCents)} \u00b7 Coolerup`,
      );
      if (!result.ok) {
        if (result.reason === "cancelled") return;
        if (result.reason === "unavailable") {
          setError(
            "Google Pay couldn't load. If you use an ad blocker, allow pay.google.com \u2014 or pay by card below.",
          );
          return;
        }
        setError(result.message ?? "Google Pay couldn't complete that payment.");
        return;
      }

      const purchase = await purchaseGiftCard({
        data: { cardId: card.id, amount, recipientEmail: email.trim(), paymentToken: result.token },
      });
      if (!purchase.ok) {
        setError(purchase.message);
        return;
      }
      finish(purchase.order);
      if (purchase.delivered) toast.success(`${card.name} gift card sent to ${email.trim()}`);
      else toast.success("Order placed \u2014 your code is on the way.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "That payment couldn't be completed.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Card entry without a gateway token can't be charged by us, so the order is
   * recorded and the buyer is told exactly what happens next. Same convention
   * the subscription sheet uses when Stripe isn't connected.
   */
  const payWithCard = async () => {
    setError(null);
    if (!handle) {
      onSignIn?.();
      return;
    }
    if (!emailOk) {
      setError("Enter a valid email so we know where to send the code.");
      return;
    }
    setBusy(true);
    try {
      const reserved = await reserveGiftCardOrder({
        data: { cardId: card.id, amount, recipientEmail: email.trim() },
      });
      if (!reserved.ok) {
        setError(reserved.message);
        return;
      }
      finish(reserved.order);
      toast.success("Order placed \u2014 we'll email your code once payment clears.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't place that order.");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!order?.code) return;
    try {
      await navigator.clipboard.writeText(order.code);
      setCopied(true);
      toast.success("Code copied");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Couldn't copy \u2014 long-press the code to copy it");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Gift className="h-5 w-5 text-primary" />
            {stage === "done" ? "Your gift card" : `${card.name} gift card`}
          </DialogTitle>
          <DialogDescription>
            {stage === "done"
              ? `Sent to ${order?.recipient_email ?? email}`
              : `${card.blurb} \u00b7 code delivered by email`}
          </DialogDescription>
        </DialogHeader>

        {stage === "done" && order ? (
          <div className="space-y-4">
            <div className={`rounded-2xl bg-gradient-to-br ${card.face} p-5 text-white shadow-lg`}>
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest text-white/70">Gift card</p>
                  <p className="font-display text-2xl">{card.name}</p>
                </div>
                <span className="text-3xl">{card.emoji}</span>
              </div>
              <p className="mt-6 font-mono text-2xl tracking-wider">
                {formatUsd(order.amount_cents)}
              </p>
            </div>

            {order.code ? (
              <div className="rounded-xl border bg-card p-4">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  Redemption code
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <code className="break-all font-mono text-base font-bold">{order.code}</code>
                  <Button size="sm" variant="outline" onClick={copyCode}>
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  </Button>
                </div>
                {order.redemption_url ? (
                  <a
                    href={order.redemption_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-3 inline-flex items-center gap-1 text-sm text-primary underline"
                  >
                    Redeem on {card.name} <ExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                <p className="font-semibold text-foreground">Order placed \u2014 code on the way</p>
                <p className="mt-1">
                  {providerLive === false
                    ? "Gift card delivery isn't connected on this deployment yet, so your order is saved as pending. Your code will be emailed once fulfilment is enabled."
                    : "We're waiting on the gift card provider to issue your code. It'll be emailed to you, and it also shows up under \u201cMy gift cards\u201d."}
                </p>
              </div>
            )}

            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : stage === "card" ? (
          <PaymentMethodForm
            planLabel={`${card.name} gift card`}
            price={price}
            trialDays={0}
            submitLabel={`Pay ${formatUsd(priceCents)}`}
            onSubmit={() => void payWithCard()}
            onCancel={() => setStage("choose")}
          />
        ) : (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-semibold">Choose an amount</p>
              <div className="grid grid-cols-3 gap-2">
                {card.amounts.map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setAmount(value)}
                    className={`rounded-xl border py-3 text-sm font-bold transition-colors ${
                      amount === value
                        ? "border-primary bg-primary/10 text-primary"
                        : "bg-card hover:border-primary/50"
                    }`}
                  >
                    ${value}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="gift-email" className="mb-1 block text-sm font-semibold">
                Deliver to
              </label>
              <input
                id="gift-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:border-primary"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                The code is emailed here. Send it to a friend to gift it.
              </p>
            </div>

            <div className="rounded-xl border bg-card p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Card value</span>
                <span className="font-semibold">{formatUsd(priceCents)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-muted-foreground">Fees</span>
                <span className="font-semibold">$0.00</span>
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2">
                <span className="font-semibold">Total today</span>
                <span className="font-display text-lg">{formatUsd(priceCents)}</span>
              </div>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <button
              type="button"
              onClick={payWithGoogle}
              disabled={busy || !emailOk}
              className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-black text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <GoogleG className="h-5 w-5" />
              )}
              <span>
                {busy ? "Processing\u2026" : `Pay ${formatUsd(priceCents)} with Google Pay`}
              </span>
            </button>

            <Button
              variant="outline"
              className="w-full"
              disabled={busy || !emailOk}
              onClick={() => setStage("card")}
            >
              Pay with a card
            </Button>

            {!gpayReady ? (
              <p className="text-xs text-muted-foreground">{gpayHint(gpayReason)}</p>
            ) : null}
            {!HAS_STRIPE ? (
              <p className="text-xs text-muted-foreground">
                Live card charging isn't connected on this deployment yet \u2014 orders are recorded
                and confirmed by the team.
              </p>
            ) : null}
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              Gift cards are issued by the retailer and can't be returned once the code is revealed.
              Codes are masked in your order history until you open them.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
