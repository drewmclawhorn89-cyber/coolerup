import { useEffect, useState } from "react";
import { PaymentMethodForm } from "@/components/PaymentMethodForm";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { HAS_STRIPE, googlePayAvailable, requestGooglePay } from "@/lib/googlepay";
import { chargePlanWithGooglePay, saveCardForTrial } from "@/lib/payments.functions";
import {
  TRIAL_DAYS,
  confirmPayment,
  maskCard,
  requestPayment,
  startTrial,
  updatePaymentMethod,
  venmoUrl,
  type PaymentMethod,
  type Plan,
  type Subscription,
} from "@/lib/subscriptions";

/** Maps a gateway brand string ("visa", "VISA") onto our CardBrand union. */
function cardBrandFrom(gatewayBrand: string, fallback: PaymentMethod["brand"]): PaymentMethod["brand"] {
  switch (gatewayBrand.toLowerCase()) {
    case "visa":
      return "visa";
    case "mastercard":
      return "mastercard";
    case "amex":
    case "american_express":
      return "amex";
    case "discover":
      return "discover";
    default:
      return fallback;
  }
}

type Mode = "trial" | "pay" | "manage";

type Props = {
  /** The plan being bought. `null` closes the sheet. */
  plan: Plan | null;
  handle?: string | null | undefined;
  sub: Subscription | null;
  onClose: () => void;
  onSignIn?: (() => void) | undefined;
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

function GooglePayButton({
  label,
  onClick,
  busy,
  disabled,
}: {
  label: string;
  onClick: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-black text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GoogleG className="h-5 w-5" />
      <span>{busy ? "Opening Google Pay…" : label}</span>
    </button>
  );
}

/**
 * Tap-to-pay sheet. Tapping any plan opens this: choose "Free trial" or
 * "Pay now", then pay with Google Pay, a card, or Venmo.
 */
export function PaymentSheet({ plan, handle, sub, onClose, onSignIn }: Props) {
  const open = Boolean(plan);
  const manage = Boolean(plan && sub?.status === "trial" && sub.planId === plan.id);
  const trialAllowed = Boolean(plan && handle && !manage && !sub);

  const [mode, setMode] = useState<Mode>("trial");
  const [stage, setStage] = useState<"choose" | "card">("choose");
  const [gpayReady, setGpayReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Reset whenever a new plan opens the sheet.
  useEffect(() => {
    if (!open) return;
    setStage("choose");
    setError(null);
    setDone(null);
    setBusy(false);
    setMode(manage ? "manage" : trialAllowed ? "trial" : "pay");
  }, [open, plan?.id, manage, trialAllowed]);

  // Only advertise Google Pay where it can actually render.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    googlePayAvailable().then((ok) => {
      if (alive) setGpayReady(ok);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!plan) return null;

  const amount = plan.price;
  const isTrialMode = mode === "trial";
  const chargeToday = isTrialMode ? 0 : amount;

  const applyPaymentMethod = (pm: PaymentMethod) => {
    if (!handle) {
      onSignIn?.();
      return;
    }
    if (manage) {
      updatePaymentMethod(handle, pm);
      setDone("Payment method saved.");
      return;
    }
    if (isTrialMode) {
      startTrial(handle, plan.id, pm);
      setDone(`Your ${TRIAL_DAYS}-day free trial has started.`);
      return;
    }
    // No gateway is connected, so a "pay now" charge is recorded as pending
    // until it is confirmed — same as the Venmo flow.
    requestPayment(handle, plan.id);
    updatePaymentMethod(handle, pm);
    setDone("Payment submitted — we'll confirm it shortly.");
  };

  const payWithGoogle = async () => {
    setError(null);
    if (!handle) {
      onSignIn?.();
      return;
    }
    setBusy(true);
    try {
      const result = await requestGooglePay(chargeToday, `${plan.label} \u00b7 Coolerup`);
      if (!result.ok) {
        if (result.reason === "cancelled") return;
        if (result.reason === "unavailable") {
          setError("Google Pay isn't available in this browser. Use a card instead.");
          return;
        }
        setError(result.message ?? "Google Pay couldn't complete that payment. Try a card instead.");
        return;
      }

      // The token is only worth something once the server has exchanged it with
      // the gateway. Until then nothing has been charged or vaulted.
      if (isTrialMode || manage) {
        const saved = await saveCardForTrial({
          data: { planId: plan.id, paymentToken: result.token },
        });
        if (!saved.ok) {
          setError(saved.message);
          return;
        }
        applyPaymentMethod({
          ...result.paymentMethod,
          brand: cardBrandFrom(saved.card.brand, result.paymentMethod.brand),
          last4: saved.card.last4 !== "0000" ? saved.card.last4 : result.paymentMethod.last4,
          expMonth: saved.card.expMonth,
          expYear: saved.card.expYear,
        });
        return;
      }

      const charge = await chargePlanWithGooglePay({
        data: { planId: plan.id, paymentToken: result.token },
      });
      if (!charge.ok) {
        setError(charge.message);
        return;
      }

      const pm: PaymentMethod = {
        ...result.paymentMethod,
        brand: cardBrandFrom(charge.card.brand, result.paymentMethod.brand),
        last4: charge.card.last4 !== "0000" ? charge.card.last4 : result.paymentMethod.last4,
        expMonth: charge.card.expMonth,
        expYear: charge.card.expYear,
      };

      // A successful charge activates the plan right away instead of leaving it
      // stuck at "pending" waiting for someone to hand-confirm a Venmo transfer.
      updatePaymentMethod(handle, pm);
      requestPayment(handle, plan.id);
      if (charge.status === "succeeded") {
        confirmPayment(handle);
        setDone(`Paid $${(charge.amountCents / 100).toFixed(2)} \u2014 ${plan.label} is active.`);
      } else if (charge.status === "processing") {
        setDone("Payment is processing \u2014 your plan activates as soon as it clears.");
      } else {
        setDone("Payment submitted \u2014 we'll confirm it shortly.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Pay couldn't complete that payment.");
    } finally {
      setBusy(false);
    }
  };

  const payWithVenmo = () => {
    if (!handle) {
      onSignIn?.();
      return;
    }
    window.open(venmoUrl(plan, handle), "_blank", "noopener,noreferrer");
    requestPayment(handle, plan.id);
    setDone("Opened Venmo — we'll activate your plan once the payment lands.");
  };

  const title = manage
    ? "Payment method"
    : isTrialMode
      ? `Start your ${TRIAL_DAYS}-day free trial`
      : `Pay for ${plan.label}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {plan.emoji} {plan.label} · ${plan.price.toFixed(2)}/mo
            {isTrialMode ? ` · free for ${TRIAL_DAYS} days, then $${amount.toFixed(2)}/mo` : ""}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              {done}
            </div>
            <Button className="w-full" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : stage === "card" ? (
          <PaymentMethodForm
            planLabel={plan.label}
            price={amount}
            trialDays={TRIAL_DAYS}
            submitLabel={
              manage ? "Save card" : isTrialMode ? "Start free trial" : `Pay $${amount.toFixed(2)}`
            }
            onCancel={() => setStage("choose")}
            onSubmit={applyPaymentMethod}
          />
        ) : (
          <div className="space-y-3">
            {!handle && (
              <div className="rounded-lg border border-border bg-muted/40 p-3 text-sm">
                Sign in first so we can attach the plan to your account.
              </div>
            )}

            {!manage && (
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setMode("trial")}
                  disabled={!trialAllowed}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors disabled:opacity-40 ${
                    isTrialMode ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Free trial
                </button>
                <button
                  type="button"
                  onClick={() => setMode("pay")}
                  className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    !isTrialMode ? "bg-background shadow-sm" : "text-muted-foreground"
                  }`}
                >
                  Pay now
                </button>
              </div>
            )}

            <div className="rounded-lg border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {manage ? (
                <>Your card is what gets charged when the trial ends. Nothing is charged today.</>
              ) : isTrialMode ? (
                <>
                  You won&apos;t be charged today. After {TRIAL_DAYS} days we charge{" "}
                  <span className="font-semibold text-foreground">${amount.toFixed(2)}/mo</span>.
                  Cancel anytime before then and you pay nothing.
                </>
              ) : (
                <>
                  Charged today:{" "}
                  <span className="font-semibold text-foreground">${amount.toFixed(2)}</span>, then
                  monthly until you cancel.
                </>
              )}
            </div>

            <GooglePayButton
              label={
                manage
                  ? "Save with Google Pay"
                  : isTrialMode
                    ? "Start trial with Google Pay"
                    : `Pay $${amount.toFixed(2)} with Google Pay`
              }
              onClick={payWithGoogle}
              busy={busy}
              disabled={!gpayReady || !handle}
            />
            {!gpayReady && (
              <p className="text-center text-[11px] text-muted-foreground">
                Google Pay isn&apos;t available in this browser — use a card or Venmo below.
              </p>
            )}
            {!HAS_STRIPE && gpayReady && (
              <p className="text-center text-[11px] text-muted-foreground">
                Test mode: the Google Pay sheet is real, but no card is charged until a payment
                gateway key is added.
              </p>
            )}

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">or</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            <Button variant="secondary" className="w-full" onClick={() => setStage("card")}>
              {isTrialMode || manage ? "Use a card instead" : "Pay with card"}
            </Button>

            {!manage && (
              <Button variant="ghost" className="w-full" onClick={payWithVenmo}>
                Pay with Venmo
              </Button>
            )}

            {!handle && (
              <Button className="w-full" onClick={() => onSignIn?.()}>
                Sign in
              </Button>
            )}

            {error && <p className="text-center text-xs text-destructive">{error}</p>}

            <p className="text-center text-[11px] leading-relaxed text-muted-foreground">
              We store only the payment type and last 4 digits on this device. Card numbers never
              touch our servers.
            </p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Small helper for panels that just want to show the stored method. */
export function StoredMethod({ pm }: { pm: PaymentMethod }) {
  return <span className="text-xs">{maskCard(pm)}</span>;
}
