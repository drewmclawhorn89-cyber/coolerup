import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Gift } from "lucide-react";
import { RedeemCodeBox } from "@/components/RedeemCodeBox";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { codeSubscriptionSummary } from "@/lib/codes";
import { useSubscription } from "@/lib/subscriptions";

export const Route = createFileRoute("/redeem")({
  head: () => ({
    meta: [
      { title: "Redeem a code — Coolerup" },
      {
        name: "description",
        content: "Redeem a Coolerup gift card or promo code.",
      },
      { property: "og:title", content: "Redeem a code — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RedeemPage,
});

function RedeemPage() {
  const auth = useAuth();
  const sub = useSubscription(auth.handle);
  const summary = codeSubscriptionSummary(sub);

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg bg-background px-4 pb-24 pt-4">
      <header className="mb-5 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <Gift className="h-5 w-5 text-primary" />
            Redeem gift card
          </h1>
          <p className="text-xs text-muted-foreground">
            Enter the code from your gift card or promo.
          </p>
        </div>
      </header>

      {summary && (
        <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold text-emerald-700 dark:text-emerald-400">{summary}</p>
          <p className="text-xs text-muted-foreground">
            Redeeming another code adds its months on top.
          </p>
        </div>
      )}

      <RedeemCodeBox handle={auth.handle} onSignIn={auth.signIn} autoFocus className="shadow-lg" />

      <div className="mt-6 space-y-2 text-sm text-muted-foreground">
        <p className="font-semibold text-foreground">How codes work</p>
        <p>
          Codes unlock a plan for a fixed number of months. When the period ends, the plan simply
          stops — there is no card on file and nothing renews automatically.
        </p>
        <p>
          You can only redeem a given code once per account. If a code has run out of uses or has
          expired, the app will tell you.
        </p>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Don&apos;t have a code?{" "}
        <Link to="/paywall" className="font-medium text-primary hover:underline">
          See plans
        </Link>
      </p>
    </main>
  );
}
