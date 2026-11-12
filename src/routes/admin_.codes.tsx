import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  Check,
  Copy,
  Gift,
  Loader2,
  Plus,
  RefreshCw,
  ShieldOff,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import {
  adminCreateCode,
  adminDeleteCode,
  adminListCodes,
  adminSetCodeActive,
  codePlanLabel,
  monthsLabel,
  normalizeCode,
  type CodePlan,
  type SubscriptionCode,
} from "@/lib/codes";

export const Route = createFileRoute("/admin_/codes")({
  head: () => ({
    meta: [
      { title: "Subscription codes — Coolerup" },
      {
        name: "description",
        content: "Create and manage Coolerup subscription gift codes.",
      },
    ],
  }),
  component: AdminCodesPage,
});

const OWNER_HANDLE = "drewmclawhorn3";

function formatDate(iso?: string | null): string {
  if (!iso) return "Never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Never";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function statusOf(code: SubscriptionCode): { label: string; tone: string } {
  if (!code.active) return { label: "Inactive", tone: "bg-muted text-muted-foreground" };
  if (code.expires_at && new Date(code.expires_at).getTime() <= Date.now()) {
    return { label: "Expired", tone: "bg-amber-500/15 text-amber-600 dark:text-amber-400" };
  }
  if (code.uses_count >= code.max_uses) {
    return { label: "Used up", tone: "bg-muted text-muted-foreground" };
  }
  return { label: "Active", tone: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" };
}

function AdminCodesPage() {
  const auth = useAuth();
  const allowed = auth.ready && auth.handle?.toLowerCase() === OWNER_HANDLE;

  const [codes, setCodes] = useState<SubscriptionCode[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [plan, setPlan] = useState<CodePlan>("premium");
  const [months, setMonths] = useState(1);
  const [maxUses, setMaxUses] = useState(100);
  const [expires, setExpires] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminListCodes();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCodes(res.value);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void refresh();
  }, [allowed, refresh]);

  const generate = async (event: React.FormEvent) => {
    event.preventDefault();
    const clean = normalizeCode(name);
    if (!clean) {
      toast.error("Enter a code name");
      return;
    }
    if (!Number.isFinite(maxUses) || maxUses < 1) {
      toast.error("Max uses must be at least 1");
      return;
    }

    setBusy("create");
    try {
      const res = await adminCreateCode({
        code: clean,
        plan,
        months,
        maxUses: Math.floor(maxUses),
        expiresAt: expires ? new Date(`${expires}T23:59:59`).toISOString() : null,
      });
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Code ${clean} created`);
      setName("");
      setExpires("");
      await refresh();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (code: string) => {
    if (!window.confirm(`Delete ${code}? People who already redeemed it keep their time.`)) {
      return;
    }
    setBusy(`delete:${code}`);
    try {
      const res = await adminDeleteCode(code);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`${code} deleted`);
      setCodes((rows) => rows.filter((row) => row.code !== code));
    } finally {
      setBusy(null);
    }
  };

  const toggle = async (row: SubscriptionCode) => {
    setBusy(`toggle:${row.code}`);
    try {
      const res = await adminSetCodeActive(row.code, !row.active);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      setCodes((rows) =>
        rows.map((item) => (item.code === row.code ? { ...item, active: !row.active } : item)),
      );
    } finally {
      setBusy(null);
    }
  };

  const copy = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(code);
      toast.success(`${code} copied`);
      window.setTimeout(() => setCopied((current) => (current === code ? null : current)), 1600);
    } catch {
      toast.error("Couldn't copy — long-press the code instead");
    }
  };

  if (!auth.ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Checking permissions…
      </main>
    );
  }

  if (!allowed) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-destructive/15">
          <ShieldOff className="h-8 w-8 text-destructive" />
        </div>
        <h1 className="text-xl font-bold">Owner only</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Subscription codes can only be created by @{OWNER_HANDLE}.
        </p>
        <Button asChild variant="secondary">
          <Link to="/">Back to the feed</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-3xl bg-background px-4 pb-24 pt-4">
      <header className="mb-5 flex items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label="Back">
          <Link to="/admin">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <Gift className="h-5 w-5 text-primary" />
            Subscription codes
          </h1>
          <p className="text-xs text-muted-foreground">
            Create gift codes and watch them being redeemed.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="gap-2"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </header>

      <form onSubmit={generate} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold">
          <Plus className="h-4 w-4 text-primary" />
          Generate a code
        </h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="space-y-1 text-sm">
            <span className="font-medium">Code name</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value.toUpperCase())}
              placeholder="COOLERUP-FREE"
              className="font-mono tracking-wide"
              autoComplete="off"
              spellCheck={false}
            />
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Plan</span>
            <select
              value={plan}
              onChange={(event) => setPlan(event.target.value as CodePlan)}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="basic">Basic</option>
              <option value="premium">Premium</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Months</span>
            <select
              value={months}
              onChange={(event) => setMonths(Number(event.target.value))}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value={1}>1 month</option>
              <option value={3}>3 months</option>
              <option value={12}>12 months</option>
            </select>
          </label>

          <label className="space-y-1 text-sm">
            <span className="font-medium">Max uses</span>
            <Input
              type="number"
              min={1}
              value={maxUses}
              onChange={(event) => setMaxUses(Number(event.target.value))}
            />
          </label>

          <label className="space-y-1 text-sm sm:col-span-2">
            <span className="font-medium">Expires (optional)</span>
            <Input
              type="date"
              value={expires}
              onChange={(event) => setExpires(event.target.value)}
            />
          </label>
        </div>

        <Button type="submit" className="mt-4 w-full gap-2" disabled={busy === "create"}>
          {busy === "create" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Gift className="h-4 w-4" />
          )}
          Generate code
        </Button>
      </form>

      <section className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">All codes</h2>
          <span className="text-xs text-muted-foreground">{codes.length} total</span>
        </div>

        {loading && codes.length === 0 ? (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            Loading codes…
          </p>
        ) : codes.length === 0 ? (
          <p className="rounded-xl border border-border p-4 text-sm text-muted-foreground">
            No codes yet. Generate your first one above.
          </p>
        ) : (
          <ul className="space-y-2">
            {codes.map((row) => {
              const status = statusOf(row);
              return (
                <li
                  key={row.code}
                  className="rounded-xl border border-border bg-card p-3 shadow-sm"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="break-all font-mono text-sm font-semibold">
                          {row.code}
                        </code>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${status.tone}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {codePlanLabel(row.plan)} · {monthsLabel(row.months)} · uses{" "}
                        <span className="font-medium text-foreground">
                          {row.uses_count}/{row.max_uses}
                        </span>{" "}
                        · expires {formatDate(row.expires_at)}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="gap-1"
                        onClick={() => void copy(row.code)}
                      >
                        {copied === row.code ? (
                          <Check className="h-3.5 w-3.5" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        Copy
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => void toggle(row)}
                        disabled={busy === `toggle:${row.code}`}
                      >
                        {row.active ? "Disable" : "Enable"}
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        aria-label={`Delete ${row.code}`}
                        className="text-destructive hover:text-destructive"
                        onClick={() => void remove(row.code)}
                        disabled={busy === `delete:${row.code}`}
                      >
                        {busy === `delete:${row.code}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
