import { Button } from "@/components/ui/button";
import { PLANS, cancelSubscription, subscribe, useSubscription } from "@/lib/subscriptions";

export function SubscriptionsPanel({ handle }: { handle?: string | null }) {
  const current = useSubscription(handle);
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4 pb-24">
      <h2 className="text-xl font-bold">Subscriptions</h2>
      <p className="text-sm text-muted-foreground">Paid plans, billed monthly. Cancel anytime.</p>
      {!handle && <p className="text-sm">Sign in to subscribe.</p>}
      {PLANS.map((p) => {
        const active = current === p.id;
        return (
          <div key={p.id} className={`rounded-xl border p-4 ${active ? "border-primary" : "border-border"}`}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{p.emoji} {p.label}</div>
              <div className="font-bold">${p.price.toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/mo</span></div>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {p.perks.map((perk) => <li key={perk}>{perk}</li>)}
            </ul>
            <Button
              className="mt-3 w-full"
              disabled={!handle}
              variant={active ? "secondary" : "default"}
              onClick={() => {
                if (!handle) return;
                if (active) cancelSubscription(handle);
                else subscribe(handle, p.id);
              }}
            >
              {active ? "Subscribed · Cancel" : `Subscribe for $${p.price.toFixed(2)}/mo`}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
