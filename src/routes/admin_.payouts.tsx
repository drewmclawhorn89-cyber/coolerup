import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Banknote, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PayoutsPanel } from "@/components/PayoutsPanel";
import { amIAdmin } from "@/lib/moderation";

export const Route = createFileRoute("/admin_/payouts")({
  head: () => ({
    meta: [
      { title: "Creator-fund payouts — Coolerup" },
      {
        name: "description",
        content: "Send and record the $1.00 first-follower rewards.",
      },
    ],
  }),
  component: PayoutsPage,
});

function PayoutsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    void amIAdmin().then((ok) => {
      if (active) setIsAdmin(ok);
    });
    return () => {
      active = false;
    };
  }, []);

  if (isAdmin === null) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Checking permissions…
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15">
          <ShieldOff className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-bold">Admins only</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          This page is for moderators. If you think you should have access, ask an admin to grant
          you the <code className="rounded bg-muted px-1">admin</code> role.
        </p>
        <Button asChild variant="secondary">
          <Link to="/">Back to the feed</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl bg-background px-4 pb-24 pt-4">
      <header className="mb-5 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/admin">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <Banknote className="h-5 w-5 text-primary" />
            Creator-fund payouts
          </h1>
          <p className="text-xs text-muted-foreground">
            $1.00 for every account that reached its first follower
          </p>
        </div>
      </header>

      <PayoutsPanel />
    </main>
  );
}
