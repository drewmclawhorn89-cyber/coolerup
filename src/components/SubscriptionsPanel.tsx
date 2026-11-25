import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PaymentSheet } from "@/components/PaymentSheet";
import { RedeemCodeBox } from "@/components/RedeemCodeBox";
import { LifetimeBanner } from "@/components/LifetimeBadge";
import { Button } from "@/components/ui/button";
import {
  ALL_ACCESS_FOREVER_PLAN,
  PLANS,
  cancelSubscriptionOnAccount,
  fetchPlansFromDb,
  formatExpiry,
  maskCard,
  subscriptionDisplayName,
  useSubscriptionState,
  type Plan,
} from "@/lib/subscriptions";
import { codeSubscriptionSummary } from "@/lib/codes";
import { hasUsedTrial, startTrial, useTrial } from "@/lib/trial";

function StatusBadge({ label, tone }: { label: string; tone: "active" | "pending" | "expired" }) {
  const styles = {
    active: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40",
    pending: "bg-amber-500/20 text-amber-300 border border-amber-500/40",
    expired: "bg-white/10 text-white/70 border border-white/15",
  } as const;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{label}</span>
  );
}

export function SubscriptionsPanel({
  handle,
  userId,
  onSignIn,
}: {
  handle?: string | null | undefined;
  userId?: string | null | undefined;
  onSignIn?: (() => void) | undefined;
}) {
  const { subscription: sub, loading: subLoading } = useSubscriptionState(handle, userId);
  const [plans, setPlans] = useState<Plan[]>(() => [...PLANS, ALL_ACCESS_FOREVER_PLAN]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);

  // Load the real plans catalogue from Supabase on mount.
  useEffect(() => {
    let alive = true;
    setPlansLoading(true);
    void fetchPlansFromDb()
      .then((loaded) => {
        if (!alive || loaded.length === 0) return;
        const hasForever = loaded.some((p) => p.id === ALL_ACCESS_FOREVER_PLAN.id);
        setPlans(hasForever ? loaded : [...loaded, ALL_ACCESS_FOREVER_PLAN]);
      })
      .finally(() => {
        if (alive) setPlansLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  // Live free-hour state: ticks every second so countdowns stay accurate.
  const trial = useTrial(handle);
  const codeSummary = codeSubscriptionSummary(sub);

  // Plan whose tap-to-pay sheet is open, if any.
  const [sheetPlan, setSheetPlan] = useState<Plan | null>(null);

  const openSheet = (plan: Plan) => {
    if (!handle && !userId) {
      onSignIn?.();
      return;
    }
    setSheetPlan(plan);
  };

  /** Begin this plan's one free hour. Each plan gets its own, once. */
  const startPlanTrial = (plan: Plan) => {
    if (!handle) {
      onSignIn?.();
      return;
    }
    if (hasUsedTrial(handle, plan.id)) {
      toast.error(`Your free ${plan.label} hour has already been used`);
      return;
    }
    startTrial(handle, plan.id);
    toast.success(`1-hour free ${plan.label} trial started`);
  };

  const handleCancel = async (planId: string) => {
    if (!handle) return;
    setCancelling(true);
    try {
      await cancelSubscriptionOnAccount({ userId, handle, planId });
      toast.success("Subscription cancelled");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't cancel subscription");
    } finally {
      setCancelling(false);
    }
  };

  const isLoading = plansLoading || subLoading;

  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 bg-black p-4 pb-24 text-white">
      <h2 className="text-xl font-bold text-white">Subscriptions</h2>
      <p className="text-sm text-white/70">
        Pick a plan and pay with Google Pay, a card, or Venmo. Your plan is saved directly to your
        account. Every plan also comes with a one-hour free trial &mdash; no card needed.
      </p>
      {!handle && !userId && <p className="text-sm text-white/80">Sign in to subscribe.</p>}

      {isLoading ? (
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-xl border border-white/15 bg-black py-12 text-white"
          role="status"
          aria-live="polite"
        >
          <Loader2 className="h-6 w-6 animate-spin text-white" />
          <p className="text-sm text-white/80">Loading your subscription…</p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-white/15 bg-black p-3 text-sm text-white">
            Current plan:{" "}
            <span className="font-semibold">
              {sub?.status === "active"
                ? `Active: ${subscriptionDisplayName(sub)}`
                : sub?.status === "pending"
                  ? `Payment pending: ${subscriptionDisplayName(sub)}`
                  : "Free"}
            </span>
          </div>

          {sub?.status === "expired" && (
            <div className="rounded-xl border border-white/15 bg-black p-3 text-sm text-white">
              <span className="font-semibold">Your subscription isn&apos;t active.</span> You are on
              the Free plan. Pick a plan below to subscribe.
            </div>
          )}

          {sub?.isLifetime && (
            <LifetimeBanner plan={sub.planId} grantedBy={sub.grantedBy ?? null} />
          )}

          {codeSummary && sub?.status === "active" && (
            <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-white">
              <p className="font-semibold text-emerald-300">{codeSummary}</p>
              <p className="text-xs text-white/70">
                Redeeming another code adds its months on top of this one.
              </p>
            </div>
          )}

          {plans.map((p) => {
            const isForeverTier = p.id === "all" || p.label === "All Access Forever";
            const current = sub?.planId === p.id;
            const pending = current && sub?.status === "pending";
            const active = current && sub?.status === "active";
            const expired = current && sub?.status === "expired";
            const trialing = !isForeverTier && trial.active && trial.planId === p.id;
            const trialSpent = !isForeverTier && hasUsedTrial(handle, p.id);
            const highlighted = pending || active || trialing;
            const lifetime = Boolean(sub?.status === "active" && sub?.isLifetime);
            const isCurrentPlan = active;
            const includedInLifetime = lifetime && !active && sub?.planId === "all";

            return (
              <div
                key={p.id}
                role="button"
                tabIndex={0}
                aria-label={`${p.label} plan`}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button, a, input")) return;
                  openSheet(p);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  if ((e.target as HTMLElement).closest("button, a, input")) return;
                  e.preventDefault();
                  openSheet(p);
                }}
                className={`cursor-pointer rounded-xl border bg-black p-4 text-white transition-colors hover:border-white/50 active:scale-[0.995] ${
                  highlighted || isCurrentPlan ? "border-white" : "border-white/15"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex flex-wrap items-center gap-2 text-lg font-semibold text-white">
                    <span>{p.emoji}</span>
                    <span>{p.label}</span>
                    {isCurrentPlan && <StatusBadge label="Current Plan" tone="active" />}
                    {pending && <StatusBadge label="Payment pending" tone="pending" />}
                    {expired && <StatusBadge label="Inactive" tone="expired" />}
                  </div>
                  <div className="text-right text-white">
                    <div className="font-bold">
                      ${p.price.toFixed(2)}
                      <span className="text-xs font-normal text-white/70">
                        {isForeverTier ? " one-time" : "/mo"}
                      </span>
                    </div>
                  </div>
                </div>

                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-white/75">
                  {p.perks.map((perk) => (
                    <li key={perk}>{perk}</li>
                  ))}
                </ul>

                {includedInLifetime ? (
                  <p className="mt-3 rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-300">
                    Included in your All Access Forever plan
                  </p>
                ) : pending ? (
                  <div className="mt-3 space-y-2">
                    <p className="text-sm text-white/80">
                      Payment pending &mdash; waiting for confirmation of your payment.
                    </p>
                    <Button
                      className="w-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
                      variant="secondary"
                      disabled={cancelling}
                      onClick={() => void handleCancel(p.id)}
                    >
                      {cancelling ? "Cancelling…" : "Cancel"}
                    </Button>
                  </div>
                ) : active ? (
                  <div className="mt-3 space-y-2">
                    {sub.paymentMethod && (
                      <div className="flex items-center justify-between rounded-lg border border-white/15 bg-black px-3 py-2 text-xs text-white">
                        <span>
                          {maskCard(sub.paymentMethod)} &middot; exp{" "}
                          {formatExpiry(sub.paymentMethod)}
                        </span>
                        <button
                          type="button"
                          className="font-medium text-white underline underline-offset-2"
                          onClick={() => openSheet(p)}
                        >
                          Change
                        </button>
                      </div>
                    )}
                    {isForeverTier ? (
                      <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300">
                        Active: All Access Forever &middot; Never expires
                      </p>
                    ) : (
                      <Button
                        className="w-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
                        variant="secondary"
                        disabled={cancelling}
                        onClick={() => void handleCancel(p.id)}
                      >
                        {cancelling ? "Cancelling…" : "Current Plan · Cancel"}
                      </Button>
                    )}
                  </div>
                ) : (
                  <>
                    {!isForeverTier && (
                      <Button
                        className="mt-3 w-full border border-white/20 bg-white/10 text-white hover:bg-white/20"
                        variant="secondary"
                        disabled={trialSpent}
                        onClick={() => startPlanTrial(p)}
                      >
                        {trialing
                          ? `Trial running \u00b7 ${trial.label} left`
                          : trialSpent
                            ? "Free trial used"
                            : "Start 1-hour free trial"}
                      </Button>
                    )}
                    <Button
                      className={`${isForeverTier ? "mt-3" : "mt-2"} w-full bg-white text-black hover:bg-white/90`}
                      onClick={() => {
                        if (!handle && !userId) {
                          onSignIn?.();
                          return;
                        }
                        openSheet(p);
                      }}
                    >
                      {isForeverTier
                        ? `Get ${p.label} \u2014 $${p.price.toFixed(2)}`
                        : sub?.status === "active"
                          ? `Switch to ${p.label} \u2014 $${p.price.toFixed(2)}/mo`
                          : `Get ${p.label} \u2014 $${p.price.toFixed(2)}/mo`}
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </>
      )}

      <p className="pt-1 text-center text-xs text-white/60">
        Monthly plans renew until you cancel. All Access Forever is a one-time purchase that never
        expires.
      </p>

      <RedeemCodeBox handle={handle} onSignIn={onSignIn} className="mt-1" />

      <PaymentSheet
        plan={sheetPlan}
        handle={handle}
        userId={userId}
        sub={sub}
        onClose={() => setSheetPlan(null)}
        onSignIn={onSignIn ?? undefined}
      />
    </div>
  );
}
