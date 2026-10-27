import { useState } from "react";
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
  PLANS,
  TRIAL_DAYS,
  cancelSubscription,
  canStartTrial,
  firstChargeDate,
  formatExpiry,
  isActive,
  maskCard,
  requestPayment,
  startTrial,
  trialDaysLeft,
  updatePaymentMethod,
  useSubscription,
  venmoUrl,
  type PaymentMethod,
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

export function SubscriptionsPanel({ handle }: { handle?: string | null }) {
  const sub = useSubscription(handle);
  const trialLeft = trialDaysLeft(sub);
  const trialAvailable = canStartTrial(handle);

  // Plan the user is currently entering a card for, if any.
  const [pendingPlan, setPendingPlan] = useState<string | null>(null);
  const pendingPlanObj = PLANS.find((p) => p.id === pendingPlan);
  const chargeDate = firstChargeDate(sub);

  const beginTrial = (pm: PaymentMethod) => {
    if (!handle || !pendingPlan) return;
    startTrial(handle, pendingPlan, pm);
    setPendingPlan(null);
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4 pb-24">
      <h2 className="text-xl font-bold">Subscriptions</h2>
      <p className="text-sm text-muted-foreground">
        Try any plan free for {TRIAL_DAYS} days. A card is required to start — you won&apos;t be
        charged until the trial ends.
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
            className={`rounded-xl border p-4 ${highlighted ? "border-primary" : "border-border"}`}
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
                {sub.paymentMethod && (
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                    <span>
                      {maskCard(sub.paymentMethod)} · exp {formatExpiry(sub.paymentMethod)}
                    </span>
                    <button
                      type="button"
                      className="font-medium text-primary"
                      onClick={() => setPendingPlan(p.id)}
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
                  Payment pending — waiting for confirmation of your Venmo payment.
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
                disabled={!handle || (!trialAvailable && !expired)}
                onClick={() => {
                  if (!handle) return;
                  if (trialAvailable) {
                    setPendingPlan(p.id);
                    return;
                  }
                  window.open(venmoUrl(p, handle), "_blank", "noopener,noreferrer");
                  requestPayment(handle, p.id);
                }}
              >
                {trialAvailable
                  ? `Start ${TRIAL_DAYS}-day free trial`
                  : `Pay $${p.price.toFixed(2)}/mo with Venmo`}
              </Button>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-center text-xs text-muted-foreground">
        One free trial per account. A card is required to start the trial and is charged
        automatically when it ends unless you cancel first.
      </p>

      <Dialog open={Boolean(pendingPlan)} onOpenChange={(open) => !open && setPendingPlan(null)}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {sub?.status === "trial" ? "Update your card" : "Add a card to start your trial"}
            </DialogTitle>
            <DialogDescription>
              {pendingPlanObj
                ? `${pendingPlanObj.label} · ${TRIAL_DAYS} days free, then $${pendingPlanObj.price.toFixed(2)}/mo.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          {pendingPlanObj && (
            <PaymentMethodForm
              planLabel={pendingPlanObj.label}
              price={pendingPlanObj.price}
              trialDays={TRIAL_DAYS}
              submitLabel={sub?.status === "trial" ? "Save card" : "Start free trial"}
              onCancel={() => setPendingPlan(null)}
              onSubmit={(pm) => {
                if (sub?.status === "trial" && handle) {
                  updatePaymentMethod(handle, pm);
                  setPendingPlan(null);
                  return;
                }
                beginTrial(pm);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
