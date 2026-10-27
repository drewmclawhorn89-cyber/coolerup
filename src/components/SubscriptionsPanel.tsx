import { useState } from "react";
import { PaymentSheet } from "@/components/PaymentSheet";
import { Button } from "@/components/ui/button";
import {
  PLANS,
  TRIAL_DAYS,
  cancelSubscription,
  canStartTrial,
  firstChargeDate,
  formatExpiry,
  maskCard,
  requestPayment,
  trialDaysLeft,
  useSubscription,
  venmoUrl,
  type Plan,
} from "@/lib/subscriptions";

function StatusBadge({
  label,
  tone,
}: {
  label: string;
  tone: "trial" | "active" | "pending" | "expired";
}) {
  const styles = {
    trial: "bg-primary/15 text-primary",
    active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    expired: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{label}</span>
  );
}

const dateFmt = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

export function SubscriptionsPanel({
  handle,
  onSignIn,
}: {
  handle?: string | null;
  onSignIn?: () => void;
}) {
  const sub = useSubscription(handle);
  const trialLeft = trialDaysLeft(sub);
  const trialAvailable = canStartTrial(handle);

  // Plan whose tap-to-pay sheet is open, if any.
  const [sheetPlan, setSheetPlan] = useState<Plan | null>(null);
  const chargeDate = firstChargeDate(sub);

  const openSheet = (plan: Plan) => {
    if (!handle) {
      onSignIn?.();
      return;
    }
    setSheetPlan(plan);
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4 pb-24">
      <h2 className="text-xl font-bold">Subscriptions</h2>
      <p className="text-sm text-muted-foreground">
        Try any plan free for {TRIAL_DAYS} days. Tap a plan to start the trial or pay now with
        Google Pay, a card, or Venmo.
      </p>
      {!handle && <p className="text-sm">Sign in to subscribe.</p>}

      {sub?.status === "trial" && (
        <div className="space-y-1 rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
          <div>
            <span className="font-semibold">Free trial active</span> — {trialLeft}{" "}
            {trialLeft === 1 ? "day" : "days"} left on{" "}
            {PLANS.find((p) => p.id === sub.planId)?.label ?? sub.planId}.
          </div>
          {chargeDate && sub.paymentMethod && (
            <div className="text-xs text-muted-foreground">
              {maskCard(sub.paymentMethod)} will be charged on {dateFmt.format(chargeDate)}. Cancel
              before then and you pay nothing.
            </div>
          )}
        </div>
      )}
      {sub?.status === "expired" && (
        <div className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
          <span className="font-semibold">Your free trial ended.</span> Pick a plan below to keep
          your perks.
        </div>
      )}

      {PLANS.map((p) => {
        const current = sub?.planId === p.id;
        const trialing = current && sub?.status === "trial";
        const pending = current && sub?.status === "pending";
        const active = current && sub?.status === "active";
        const expired = current && sub?.status === "expired";
        const highlighted = trialing || pending || active;

        return (
          <div
            key={p.id}
            role="button"
            tabIndex={0}
            aria-label={`${p.label} plan`}
            onClick={(e) => {
              // Let real controls inside the card handle their own clicks.
              if ((e.target as HTMLElement).closest("button, a, input")) return;
              openSheet(p);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              if ((e.target as HTMLElement).closest("button, a, input")) return;
              e.preventDefault();
              openSheet(p);
            }}
            className={`cursor-pointer rounded-xl border p-4 transition-colors hover:border-primary/60 active:scale-[0.995] ${
              highlighted ? "border-primary" : "border-border"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                <span>{p.emoji}</span>
                <span>{p.label}</span>
                {trialing && <StatusBadge label={`Trial · ${trialLeft}d left`} tone="trial" />}
                {active && <StatusBadge label="Active" tone="active" />}
                {pending && <StatusBadge label="Payment pending" tone="pending" />}
                {expired && <StatusBadge label="Trial ended" tone="expired" />}
              </div>
              <div className="text-right">
                <div className="font-bold">
                  ${p.price.toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
                {!active && (
                  <div className="text-xs font-medium text-primary">{TRIAL_DAYS} days free</div>
                )}
              </div>
            </div>

            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {p.perks.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>

            {trialing ? (
              <div className="mt-3 space-y-2">
                {!sub.paymentMethod && (
                  <div className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                    <p>
                      <span className="font-semibold">
                        Add a payment method to keep your trial.
                      </span>{" "}
                      This trial started before payments were required, so nothing is on file.
                    </p>
                    <Button className="w-full" size="sm" onClick={() => openSheet(p)}>
                      Add payment method
                    </Button>
                  </div>
                )}
                {sub.paymentMethod && (
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                    <span>
                      {maskCard(sub.paymentMethod)} · exp {formatExpiry(sub.paymentMethod)}
                    </span>
                    <button
                      type="button"
                      className="font-medium text-primary"
                      onClick={() => openSheet(p)}
                    >
                      Change
                    </button>
                  </div>
                )}
                <Button
                  className="w-full"
                  onClick={() => {
                    if (!handle) return;
                    window.open(venmoUrl(p, handle), "_blank", "noopener,noreferrer");
                    requestPayment(handle, p.id);
                  }}
                >
                  Pay now instead — ${p.price.toFixed(2)}/mo
                </Button>
                <Button
                  className="w-full"
                  variant="ghost"
                  onClick={() => handle && cancelSubscription(handle)}
                >
                  Cancel trial
                </Button>
              </div>
            ) : pending ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm">
                  Payment pending — waiting for confirmation of your payment.
                </p>
                <Button
                  className="w-full"
                  variant="secondary"
                  onClick={() => handle && cancelSubscription(handle)}
                >
                  Cancel
                </Button>
              </div>
            ) : active ? (
              <Button
                className="mt-3 w-full"
                variant="secondary"
                onClick={() => handle && cancelSubscription(handle)}
              >
                Subscribed · Cancel
              </Button>
            ) : (
              <Button
                className="mt-3 w-full"
                onClick={() => {
                  if (!handle) {
                    onSignIn?.();
                    return;
                  }
                  openSheet(p);
                }}
              >
                {trialAvailable
                  ? `Start ${TRIAL_DAYS}-day free trial`
                  : `Get ${p.label} — $${p.price.toFixed(2)}/mo`}
              </Button>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-center text-xs text-muted-foreground">
        One free trial per account. A payment method is required to start the trial and is charged
        automatically when it ends unless you cancel first.
      </p>

      <PaymentSheet
        plan={sheetPlan}
        handle={handle}
        sub={sub}
        onClose={() => setSheetPlan(null)}
        onSignIn={onSignIn ?? undefined}
      />
    </div>
  );
}
