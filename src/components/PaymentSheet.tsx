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
import {
  HAS_STRIPE,
  googlePayDiagnose,
  requestGooglePay,
  resetGooglePay,
  type GooglePayReason,
} from "@/lib/googlepay";
import { chargePlanWithGooglePay, saveCardForTrial } from "@/lib/payments.functions";
import {
  maskCard,
  saveSubscriptionToAccount,
  venmoUrl,
  type PaymentMethod,
  type Plan,
  type Subscription,
} from "@/lib/subscriptions";

/** Maps a gateway brand string ("visa", "VISA") onto our CardBrand union. */
function cardBrandFrom(
  gatewayBrand: string,
  fallback: PaymentMethod["brand"],
): PaymentMethod["brand"] {
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

/** Plain-English explanation for why the Google Pay button is disabled. */
function gpayHint(reason: GooglePayReason): string {
  switch (reason) {
    case "script-blocked":
      return "Google Pay couldn't load — an ad blocker or network filter may be blocking pay.google.com. Allow it and tap Try again.";
    case "no-api":
      return "Google Pay didn't pre-check in this browser. The button still works \u2014 if the sheet won't open, try Chrome or Safari.";
    case "no-wallet":
      return "No Google Pay account was detected on this device. If the sheet won't open, add a card at pay.google.com or use a card below.";
    default:
      return "Google Pay isn't available here — use a card below.";
  }
}

type Props = {
  /** The plan being bought. `null` closes the sheet. */
  plan: Plan | null;
  handle?: string | null | undefined;
  userId?: string | null | undefined;
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
      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg border border-white/20 bg-black text-sm font-medium text-white transition-opacity hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <GoogleG className="h-5 w-5" />
      <span>{busy ? "Opening Google Pay…" : label}</span>
    </button>
  );
}

/**
 * Tap-to-pay sheet. Persists purchases and payment method updates directly to
 * Supabase keyed by `user_id` ONLY (updates the single row for `user_id`).
 */
export function PaymentSheet({ plan, handle, userId, sub, onClose, onSignIn }: Props) {
  const open = Boolean(plan);
  // Managing an existing plan means swapping the card, not buying again.
  const manage = Boolean(
    plan && sub && sub.planId === plan.id && (sub.status === "active" || sub.status === "pending"),
  );

  const [stage, setStage] = useState<"choose" | "card">("choose");
  const [gpayReady, setGpayReady] = useState(false);
  const [gpayReason, setGpayReason] = useState<GooglePayReason>("no-api");
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
  }, [open, plan?.id, manage]);

  const checkGooglePay = () => {
    googlePayDiagnose().then((d) => {
      setGpayReady(d.ready);
      setGpayReason(d.reason);
    });
  };

  useEffect(() => {
    if (!open) return;
    let alive = true;
    googlePayDiagnose().then((d) => {
      if (!alive) return;
      setGpayReady(d.ready);
      setGpayReason(d.reason);
    });
    return () => {
      alive = false;
    };
  }, [open]);

  if (!plan) return null;

  const amount = plan.price;

  const isForever = plan.id === "all";

  const applyPaymentMethod = async (pm: PaymentMethod) => {
    setError(null);
    if (!handle && !userId) {
      onSignIn?.();
      return;
    }
    setBusy(true);
    try {
      const targetHandle = handle || userId || "user";
      if (manage) {
        await saveSubscriptionToAccount({
          userId,
          handle: targetHandle,
          planId: plan.id,
          planName: plan.label,
          status: sub?.status === "pending" ? "pending" : "active",
          paymentMethod: pm,
          paymentVerified: sub?.status !== "pending",
          ...(isForever ? { expiresAt: null } : {}),
        });
        setDone(`Payment method (${maskCard(pm)}) saved to your account.`);
        return;
      }

      await saveSubscriptionToAccount({
        userId,
        handle: targetHandle,
        planId: plan.id,
        planName: plan.label,
        status: "active",
        paymentMethod: pm,
        paymentVerified: true,
        ...(isForever ? { expiresAt: null } : {}),
      });
      setDone(`${plan.label} is active (${maskCard(pm)}) — saved to your account.`);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your subscription to your account.",
      );
    } finally {
      setBusy(false);
    }
  };

  const payWithGoogle = async () => {
    setError(null);
    if (!handle && !userId) {
      onSignIn?.();
      return;
    }
    setBusy(true);
    try {
      const targetHandle = handle || userId || "user";
      const result = await requestGooglePay(amount, `${plan.label} \u00b7 Coolerup`);
      if (!result.ok) {
        if (result.reason === "cancelled") return;
        if (result.reason === "unavailable") {
          setError(
            "Google Pay couldn't load. If you use an ad blocker, allow pay.google.com and try again \u2014 otherwise use a card below.",
          );
          return;
        }
        setError(
          result.message ?? "Google Pay couldn't complete that payment. Try a card instead.",
        );
        return;
      }

      if (manage) {
        const saved = await saveCardForTrial({
          data: { planId: plan.id, paymentToken: result.token },
        });
        if (!saved.ok) {
          setError(saved.message);
          return;
        }
        await saveSubscriptionToAccount({
          userId,
          handle: targetHandle,
          planId: plan.id,
          planName: plan.label,
          status: sub?.status === "pending" ? "pending" : "active",
          paymentMethod: {
            ...result.paymentMethod,
            brand: cardBrandFrom(saved.card.brand, result.paymentMethod.brand),
            last4: saved.card.last4 !== "0000" ? saved.card.last4 : result.paymentMethod.last4,
            expMonth: saved.card.expMonth,
            expYear: saved.card.expYear,
          },
          paymentVerified: sub?.status !== "pending",
          ...(isForever ? { expiresAt: null } : {}),
        });
        setDone("Payment method saved to your account.");
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

      const nextStatus = charge.status === "succeeded" ? "active" : "pending";
      await saveSubscriptionToAccount({
        userId,
        handle: targetHandle,
        planId: plan.id,
        planName: plan.label,
        status: nextStatus,
        paymentMethod: pm,
        paymentVerified: charge.status === "succeeded",
        ...(isForever ? { expiresAt: null } : {}),
      });

      if (charge.status === "succeeded") {
        setDone(`Paid $${(charge.amountCents / 100).toFixed(2)} \u2014 ${plan.label} is active.`);
      } else {
        setDone("Payment is processing \u2014 your plan activates as soon as it clears.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Google Pay couldn't complete that payment.");
    } finally {
      setBusy(false);
    }
  };

  const payWithVenmo = async () => {
    setError(null);
    if (!handle && !userId) {
      onSignIn?.();
      return;
    }
    setBusy(true);
    try {
      const targetHandle = handle || userId || "user";
      window.open(venmoUrl(plan, handle), "_blank", "noopener,noreferrer");
      await saveSubscriptionToAccount({
        userId,
        handle: targetHandle,
        planId: plan.id,
        planName: plan.label,
        status: "pending",
        paymentMethod: "Venmo",
        paymentVerified: false,
      });
      setDone("Opened Venmo — saved as pending to your account until confirmed.");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Could not save your Venmo request to your account.",
      );
    } finally {
      setBusy(false);
    }
  };

  const title = manage ? "Payment method" : `Pay for ${plan.label}`;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88dvh] overflow-y-auto border-white/15 bg-black text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          <DialogDescription className="text-white/70">
            {plan.emoji} {plan.label} · ${plan.price.toFixed(2)}
            {isForever ? " one-time" : "/mo"}
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-white">
              {done}
            </div>
            <Button className="w-full bg-white text-black hover:bg-white/90" onClick={onClose}>
              Done
            </Button>
          </div>
        ) : stage === "card" ? (
          <div className="space-y-3">
            <PaymentMethodForm
              planLabel={plan.label}
              price={amount}
              submitLabel={busy ? "Saving…" : manage ? "Save card" : `Pay $${amount.toFixed(2)}`}
              onCancel={() => setStage("choose")}
              onSubmit={(pm) => void applyPaymentMethod(pm)}
            />
            {error && <p className="text-center text-xs text-red-400">{error}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            {!handle && !userId && (
              <div className="rounded-lg border border-white/15 bg-black p-3 text-sm text-white">
                Sign in first so we can attach the plan to your account.
              </div>
            )}

            <div className="rounded-lg border border-white/15 bg-black p-3 text-xs text-white/75">
              {manage ? (
                <>Your card is what renews the plan. Nothing is charged right now.</>
              ) : isForever ? (
                <>
                  Charged today:{" "}
                  <span className="font-semibold text-white">${amount.toFixed(2)}</span> once — All
                  Access Forever never expires.
                </>
              ) : (
                <>
                  Charged today:{" "}
                  <span className="font-semibold text-white">${amount.toFixed(2)}</span>, then
                  monthly until you cancel.
                </>
              )}
            </div>

            <GooglePayButton
              label={manage ? "Save with Google Pay" : `Pay $${amount.toFixed(2)} with Google Pay`}
              onClick={() => void payWithGoogle()}
              busy={busy}
              disabled={busy}
            />
            {!gpayReady && (
              <div className="space-y-1 text-center">
                <p className="text-[11px] text-white/60">{gpayHint(gpayReason)}</p>
                <p className="text-[11px] text-white/60">
                  You can still tap the button above — it will open the Google Pay sheet or tell you
                  exactly what went wrong.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    resetGooglePay();
                    checkGooglePay();
                  }}
                  className="text-[11px] font-medium text-white underline underline-offset-2"
                >
                  Re-check Google Pay
                </button>
              </div>
            )}
            {!HAS_STRIPE && gpayReady && (
              <p className="text-center text-[11px] text-white/60">
                Test mode: the Google Pay sheet is real, but no card is charged until a payment
                gateway key is added.
              </p>
            )}

            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-white/15" />
              <span className="text-[11px] uppercase tracking-wide text-white/60">or</span>
              <span className="h-px flex-1 bg-white/15" />
            </div>

            <Button
              variant="secondary"
              className="w-full bg-white text-black hover:bg-white/90"
              disabled={busy}
              onClick={() => setStage("card")}
            >
              {manage ? "Use a card instead" : "Pay with card"}
            </Button>

            {!manage && (
              <Button
                variant="ghost"
                className="w-full border border-white/15 text-white hover:bg-white/10"
                disabled={busy}
                onClick={() => void payWithVenmo()}
              >
                Pay with Venmo
              </Button>
            )}

            {!handle && !userId && (
              <Button
                className="w-full bg-white text-black hover:bg-white/90"
                onClick={() => onSignIn?.()}
              >
                Sign in
              </Button>
            )}

            {error && <p className="text-center text-xs text-red-400">{error}</p>}

            <p className="text-center text-[11px] leading-relaxed text-white/60">
              Your subscription is saved to your account. We store only the payment type and last 4
              digits.
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
