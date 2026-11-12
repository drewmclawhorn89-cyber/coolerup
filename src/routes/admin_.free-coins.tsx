import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Loader2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FreeCoinClaimsPanel } from "@/components/FreeCoinClaimsPanel";
import { amIAdmin } from "@/lib/moderation";

export const Route = createFileRoute("/admin_/free-coins")({
  head: () => ({
    meta: [
      { title: "Free coin claims — Coolerup" },
      { name: "description", content: "Live feed of free coin claims via Venmo." },
    ],
  }),
  component: AdminFreeCoinsPage,
});

function AdminFreeCoinsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    void amIAdmin().then((ok) => {
      if (mounted) setIsAdmin(ok);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <div className="mx-auto min-h-dvh w-full max-w-lg bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur">
        <Button variant="ghost" size="icon" aria-label="Back" asChild>
          <Link to="/admin">
            <ArrowLeft />
          </Link>
        </Button>
        <h1 className="font-display text-lg font-extrabold">Free coin claims</h1>
      </header>

      <div className="px-4 pt-4">
        {isAdmin === null ? (
          <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking access…
          </p>
        ) : !isAdmin ? (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
            <ShieldOff className="h-8 w-8 text-muted-foreground" />
            <p>Only hosts can see free coin claims.</p>
          </div>
        ) : (
          <FreeCoinClaimsPanel />
        )}
      </div>
    </div>
  );
}
