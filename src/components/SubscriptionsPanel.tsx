import { useState } from "react";
import { PaymentSheet } from "@/components/PaymentSheet";
import { Button } from "@/components/ui/button";
import {
  PLANS,
  cancelSubscription,
  formatExpiry,
  maskCard,
  useSubscription,
  type Plan,
} from "@/lib/subscriptions";

function StatusBadge({ label, tone }: { label: string; tone: "active" | "pending" | "expired" }) {
  const styles = {
    active: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
    pending: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
    expired: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{label}</span>
  );
}

export function SubscriptionsPanel({
  handle,
  onSignIn,
}: {
  handle?: string | null;
  onSignIn?: () => void;
}) {
  const sub = useSubscription(handle);

  // Plan whose tap-to-pay sheet is open, if any.
  const [sheetPlan, setSheetPlan] = useState<Plan | null>(null);

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
        Pick a plan and pay with Google Pay, a card, or Venmo. Your perks start as soon as the
        payment is confirmed.
      </p>
      {!handle && <p className="text-sm">Sign in to subscribe.</p>}

      {sub?.status === "expired" && (
        <div className="rounded-xl border border-border bg-muted/50 p-3 text-sm">
          <span className="font-semibold">Your subscription isn&apos;t active.</span> Pick a plan
          below to get your perks back.
        </div>
      )}

      {PLANS.map((p) => {
        const current = sub?.planId === p.id;
        const pending = current && sub?.status === "pending";
        const active = current && sub?.status === "active";
        const expired = current && sub?.status === "expired";
        const highlighted = pending || active;

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
                {active && <StatusBadge label="Active" tone="active" />}
                {pending && <StatusBadge label="Payment pending" tone="pending" />}
                {expired && <StatusBadge label="Inactive" tone="expired" />}
              </div>
              <div className="text-right">
                <div className="font-bold">
                  ${p.price.toFixed(2)}
                  <span className="text-xs font-normal text-muted-foreground">/mo</span>
                </div>
              </div>
            </div>

            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {p.perks.map((perk) => (
                <li key={perk}>{perk}</li>
              ))}
            </ul>

            {pending ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm">
                  Payment pending &mdash; waiting for confirmation of your payment.
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
              <div className="mt-3 space-y-2">
                {sub.paymentMethod && (
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                    <span>
                      {maskCard(sub.paymentMethod)} &middot; exp {formatExpiry(sub.paymentMethod)}
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
                  variant="secondary"
                  onClick={() => handle && cancelSubscription(handle)}
                >
                  Subscribed &middot; Cancel
                </Button>
              </div>
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
                {`Get ${p.label} \u2014 $${p.price.toFixed(2)}/mo`}
              </Button>
            )}
          </div>
        );
      })}

      <p className="pt-1 text-center text-xs text-muted-foreground">
        Plans renew monthly until you cancel. Cancel anytime and you keep your perks until the end
        of the period you paid for.
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
