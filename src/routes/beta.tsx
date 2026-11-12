import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BetaBanner } from "@/components/BetaBanner";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { BETA_FLAGS, canAccessBeta, loadBetaFlags, setBetaFlag, type BetaFlagName } from "@/lib/beta";

export const Route = createFileRoute("/beta")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Coolerup Beta — Private" },
      { name: "description", content: "Private test area for Coolerup." },
      { property: "og:title", content: "Coolerup Beta — Private" },
      { property: "og:description", content: "Private test area for Coolerup." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: BetaPage,
});

const SHORTCUTS = [
  { to: "/", label: "For You" },
  { to: "/live", label: "LIVE" },
  { to: "/search", label: "Search" },
  { to: "/wallet", label: "Vault" },
] as const;

function BetaPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [state, setState] = useState<"checking" | "ok" | "denied">("checking");
  const [flags, setFlags] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!auth.ready) return;
    let cancelled = false;
    canAccessBeta(auth.user?.id).then(async (ok) => {
      if (cancelled) return;
      if (!ok) {
        setState("denied");
        setTimeout(() => navigate({ to: "/", replace: true }), 2000);
        return;
      }
      setFlags(await loadBetaFlags());
      setState("ok");
    });
    return () => {
      cancelled = true;
    };
  }, [auth.ready, auth.user?.id, navigate]);

  async function toggle(name: BetaFlagName, on: boolean) {
    if (!auth.user) return;
    setFlags((f) => ({ ...f, [name]: on }));
    try {
      await setBetaFlag(name, on, auth.user.id);
    } catch {
      setFlags((f) => ({ ...f, [name]: !on }));
      toast.error("Couldn't save that setting");
    }
  }

  if (state === "checking") {
    return <div className="flex h-dvh items-center justify-center bg-background text-muted-foreground">Checking access…</div>;
  }
  if (state === "denied") {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 bg-background px-6 text-center">
        <h1 className="text-2xl font-bold text-foreground">Private Beta — Only owner can access</h1>
        <p className="text-muted-foreground">Taking you back to For You…</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background text-foreground" style={{ paddingBottom: "env(safe-area-inset-bottom)" }}>
      <BetaBanner />
      <main className="mx-auto max-w-xl space-y-8 px-4 py-8">
        <header>
          <h1 className="text-3xl font-extrabold">Coolerup Beta</h1>
          <p className="text-muted-foreground">Same videos, likes and followers — test switches here don't change the main app.</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-lg font-bold">Beta settings</h2>
          {BETA_FLAGS.map((f) => (
            <label key={f.name} className="flex items-center justify-between rounded-xl border border-border bg-card px-4 py-3">
              <span className="font-medium">{f.label}</span>
              <Switch checked={!!flags[f.name]} onCheckedChange={(v) => toggle(f.name, v)} />
            </label>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-lg font-bold">Open the app</h2>
          <div className="grid grid-cols-2 gap-3">
            {SHORTCUTS.map((s) => (
              <Link key={s.to} to={s.to} className="rounded-xl bg-primary px-4 py-3 text-center font-semibold text-primary-foreground">
                {s.label}
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
