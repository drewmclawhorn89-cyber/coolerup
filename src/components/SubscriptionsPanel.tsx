import { Button } from "@/components/ui/button";
import {
  PLANS,
  TRIAL_DAYS,
  cancelSubscription,
  canStartTrial,
  isActive,
  requestPayment,
  startTrial,
  trialDaysLeft,
  useSubscription,
  venmoUrl,
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

export function SubscriptionsPanel({ handle }: { handle?: string | null }) {
  const sub = useSubscription(handle);
  const trialLeft = trialDaysLeft(sub);
  const trialAvailable = canStartTrial(handle);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4 pb-24">
      <h2 className="text-xl font-bold">Subscriptions</h2>
      <p className="text-sm text-muted-foreground">
        Try any plan free for {TRIAL_DAYS} days. Cancel anytime — you won&apos;t be charged until
        the trial ends.
      </p>
      {!handle && <p className="text-sm">Sign in to subscribe.</p>}

      {sub?.status === "trial" && (
        <div className="rounded-xl border border-primary/40 bg-primary/5 p-3 text-sm">
          <span className="font-semibold">Free trial active</span> — {trialLeft}{" "}
          {trialLeft === 1 ? "day" : "days"} left on{" "}
          {PLANS.find((p) => p.id === sub.planId)?.label ?? sub.planId}. Pay before it ends to keep
          your perks.
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
              <div className="flex items-center gap-2 text-lg font-semibold">
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
                <Button
                  className="w-full"
                  onClick={() => {
                    if (!handle) return;
                    window.open(venmoUrl(p, handle), "_blank", "noopener,noreferrer");
                    requestPayment(handle, p.id);
                  }}
                >
                  Keep {p.label} — pay ${p.price.toFixed(2)}/mo
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
                    startTrial(handle, p.id);
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
        One free trial per account. Billed monthly via Venmo after the trial.
      </p>
    </div>
  );
}
