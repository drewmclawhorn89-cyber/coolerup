import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crown, Loader2, RefreshCw, Search, ShieldOff, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LifetimeBadge } from "@/components/LifetimeBadge";
import { useAuth } from "@/hooks/useAuth";
import {
  grantLifetime,
  lifetimePlanLabel,
  listLifetime,
  revokeLifetime,
  searchUsers,
  type LifetimePlan,
  type LifetimeUser,
} from "@/lib/subscription";

export const Route = createFileRoute("/admin_/subscriptions")({
  head: () => ({
    meta: [
      { title: "Lifetime subscriptions — Coolerup" },
      {
        name: "description",
        content: "Give and revoke lifetime Coolerup subscriptions.",
      },
    ],
  }),
  component: AdminSubscriptionsPage,
});

const OWNER_HANDLE = "drewmclawhorn3";

const PLAN_OPTIONS: { id: LifetimePlan; label: string; blurb: string }[] = [
  { id: "pro", label: "Give Pro Forever", blurb: "Pro perks, never expires" },
  { id: "vip", label: "Give VIP Forever", blurb: "VIP perks, never expires" },
  { id: "all", label: "Give All Forever", blurb: "Pro + VIP + Beta + 1,000 coins" },
];

/** "Nov 8" — the short form the grant list uses. */
function shortDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function AdminSubscriptionsPage() {
  const auth = useAuth();
  const allowed = auth.ready && auth.handle?.toLowerCase() === OWNER_HANDLE;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LifetimeUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<LifetimeUser | null>(null);
  const [plan, setPlan] = useState<LifetimePlan>("all");
  const [granting, setGranting] = useState(false);

  const [holders, setHolders] = useState<LifetimeUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setHolders(await listLifetime());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void refresh();
  }, [allowed, refresh]);

  // Debounced typeahead. A sequence number drops out-of-order responses so a
  // slow "fa" cannot overwrite the results for "fan03768".
  const seq = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    const mine = ++seq.current;
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchUsers(q).then((users) => {
        if (seq.current !== mine) return;
        setResults(users);
        setSearching(false);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const give = async () => {
    if (!selected) {
      toast.error("Search for a user first");
      return;
    }
    setGranting(true);
    try {
      const res = await grantLifetime(selected.handle, plan);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`@${selected.handle} now has ${lifetimePlanLabel(plan)}`);
      setSelected(null);
      setQuery("");
      setResults([]);
      await refresh();
    } finally {
      setGranting(false);
    }
  };

  const takeAway = async (user: LifetimeUser) => {
    setRevoking(user.userId);
    try {
      const res = await revokeLifetime(user.userId);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      toast.success(`Took lifetime access away from @${user.handle}`);
      setHolders((rows) => rows.filter((row) => row.userId !== user.userId));
    } finally {
      setRevoking(null);
    }
  };

  const planBlurb = useMemo(
    () => PLAN_OPTIONS.find((option) => option.id === plan)?.blurb ?? "",
    [plan],
  );

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
          Lifetime plans can only be given by @{OWNER_HANDLE}.
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
            <Crown className="h-5 w-5 text-amber-500" />
            Lifetime subscriptions
          </h1>
          <p className="text-xs text-muted-foreground">
            Give a plan that never expires — or take it back instantly.
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

      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <h2 className="flex items-center gap-2 font-semibold">
          <Search className="h-4 w-4 text-primary" />
          Find a user
        </h2>

        <label className="mt-3 block space-y-1 text-sm">
          <span className="font-medium">Username</span>
          <Input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            placeholder="@fan03768"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search users by username"
          />
        </label>

        {searching && (
          <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" /> Searching…
          </p>
        )}

        {!searching && query.trim().length >= 2 && results.length === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">No user matches that handle.</p>
        )}

        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-border overflow-hidden rounded-xl border border-border">
            {results.map((user) => (
              <li key={user.userId}>
                <button
                  type="button"
                  onClick={() => setSelected(user)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                    selected?.userId === user.userId ? "bg-muted" : ""
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">@{user.handle}</span>
                  {user.displayName && (
                    <span className="hidden truncate text-xs text-muted-foreground sm:inline">
                      {user.displayName}
                    </span>
                  )}
                  {user.isLifetime && <LifetimeBadge plan={user.plan} />}
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected && (
          <div className="mt-3 rounded-xl border border-primary/40 bg-primary/5 p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold">@{selected.handle}</p>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Clear selection"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="mt-3 block space-y-1 text-sm">
              <span className="font-medium">Plan</span>
              <select
                value={plan}
                onChange={(event) => setPlan(event.target.value as LifetimePlan)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                aria-label="Lifetime plan"
              >
                {PLAN_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <p className="mt-1 text-xs text-muted-foreground">{planBlurb}</p>

            <Button className="mt-3 w-full gap-2" onClick={() => void give()} disabled={granting}>
              {granting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Crown className="h-4 w-4" />
              )}
              Give Forever
            </Button>
          </div>
        )}
      </section>

      <section className="mt-5">
        <h2 className="mb-2 flex items-center gap-2 font-semibold">
          <Crown className="h-4 w-4 text-amber-500" />
          Lifetime holders
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
            {holders.length}
          </span>
        </h2>

        {loading && holders.length === 0 ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : holders.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
            Nobody has a lifetime plan yet.
          </p>
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {holders.map((user) => (
              <li key={user.userId} className="flex items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="truncate">@{user.handle}</span>
                    <LifetimeBadge plan={user.plan} />
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {lifetimePlanLabel(user.plan)}
                    {user.grantedAt ? ` · Since ${shortDate(user.grantedAt)}` : ""}
                  </p>
                </div>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => void takeAway(user)}
                  disabled={revoking === user.userId}
                >
                  {revoking === user.userId ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Take Away"
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
