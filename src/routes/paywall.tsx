import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Sparkles } from "lucide-react";
import { SubscriptionsPanel } from "@/components/SubscriptionsPanel";
import { RedeemCodeBox } from "@/components/RedeemCodeBox";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";

export const Route = createFileRoute("/paywall")({
  head: () => ({
    meta: [
      { title: "Plans — Coolerup" },
      {
        name: "description",
        content: "Pick a Coolerup plan or redeem a gift card code.",
      },
      { property: "og:title", content: "Plans — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PaywallPage,
});

function PaywallPage() {
  const auth = useAuth();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl bg-black px-4 pb-24 pt-4 text-white">
      <header className="mb-4 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold text-white">
            <Sparkles className="h-5 w-5 text-white" />
            Plans
          </h1>
          <p className="text-xs text-white/70">Unlock badges, offline downloads and more.</p>
        </div>
      </header>

      <SubscriptionsPanel handle={auth.handle} onSignIn={auth.signIn} />

      <div className="mx-auto w-full max-w-2xl px-4">
        <RedeemCodeBox handle={auth.handle} onSignIn={auth.signIn} className="mt-2" />
        <p className="mt-3 text-center text-xs text-white/60">
          Codes are case-insensitive. Each code can only be redeemed once per account.
        </p>
      </div>
    </main>
  );
}
