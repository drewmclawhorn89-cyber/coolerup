import { Button } from "@/components/ui/button";
import { PLANS, cancelSubscription, subscribe, useSubscription, venmoUrl } from "@/lib/subscriptions";

export function SubscriptionsPanel({ handle }: { handle?: string | null }) {
  const stored = useSubscription(handle);
  const pendingId = stored?.startsWith("pending:") ? stored.slice(8) : null;
  const activeId = stored && !pendingId ? stored : null;
  return (
    <div className="mx-auto w-full max-w-2xl space-y-3 p-4 pb-24">
      <h2 className="text-xl font-bold">Subscriptions</h2>
      <p className="text-sm text-muted-foreground">Paid plans, billed monthly via Venmo.</p>
      {!handle && <p className="text-sm">Sign in to subscribe.</p>}
      {PLANS.map((p) => {
        const active = activeId === p.id;
        const pending = pendingId === p.id;
        return (
          <div key={p.id} className={`rounded-xl border p-4 ${active || pending ? "border-primary" : "border-border"}`}>
            <div className="flex items-center justify-between">
              <div className="text-lg font-semibold">{p.emoji} {p.label}</div>
              <div className="font-bold">${p.price.toFixed(2)}<span className="text-xs font-normal text-muted-foreground">/mo</span></div>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {p.perks.map((perk) => <li key={perk}>{perk}</li>)}
            </ul>
            {pending ? (
              <div className="mt-3 space-y-2">
                <p className="text-sm">Payment pending — waiting for confirmation of your Venmo payment.</p>
                <Button className="w-full" variant="secondary" onClick={() => handle && cancelSubscription(handle)}>Cancel</Button>
              </div>
            ) : active ? (
              <Button className="mt-3 w-full" variant="secondary" onClick={() => handle && cancelSubscription(handle)}>Subscribed · Cancel</Button>
            ) : (
              <Button
                className="mt-3 w-full"
                disabled={!handle}
                onClick={() => {
                  if (!handle) return;
                  window.open(venmoUrl(p, handle), "_blank", "noopener,noreferrer");
                  subscribe(handle, p.id);
                }}
              >
                Pay ${p.price.toFixed(2)}/mo with Venmo
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
