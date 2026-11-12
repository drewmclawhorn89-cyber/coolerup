import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Coins, Crown, Loader2, RefreshCw, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import {
  FREE_COINS_AMOUNT,
  adminFreeCoinClaims,
  claimAgo,
  freeCoinStats,
  type FreeCoinClaim,
} from "@/lib/coins";

const VENMO_BLUE = "#3D95CE";

function initials(name: string | null) {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  return clean.slice(0, 2).toUpperCase();
}

function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string;
  value: string;
  hint?: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <p className="mt-2 font-display text-2xl font-extrabold tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ClaimRow({ row, now }: { row: FreeCoinClaim; now: number }) {
  return (
    <li className="flex items-center gap-3 border-b border-border/60 py-3 last:border-0">
      {row.avatar_url ? (
        <img
          src={row.avatar_url}
          alt=""
          className="h-10 w-10 shrink-0 rounded-full object-cover"
          loading="lazy"
        />
      ) : (
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-white"
          style={{ backgroundColor: VENMO_BLUE }}
        >
          {initials(row.username)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">@{row.username || "guest"}</p>
        <p className="text-xs text-muted-foreground">
          Got {row.coins_given ?? FREE_COINS_AMOUNT} coins via Venmo
        </p>
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
        {claimAgo(row.claimed_at, now)}
      </span>
    </li>
  );
}

/**
 * Host-facing "Free Coins Claims" panel: today's totals, all-time totals, the
 * top claimers, and a live feed of every claim. New claims arrive over a
 * Supabase realtime channel and raise a toast for the host.
 */
export function FreeCoinClaimsPanel({ limit = 200 }: { limit?: number }) {
  const [rows, setRows] = useState<FreeCoinClaim[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await adminFreeCoinClaims(limit);
      seen.current = new Set(next.map((r) => r.id));
      setRows(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load claims");
    } finally {
      setLoading(false);
    }
  }, [limit]);

  useEffect(() => {
    void load();
  }, [load]);

  // Keep relative timestamps ("4m ago") honest without refetching.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("free-coin-claims:admin")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "free_coin_claims" },
        (payload) => {
          const row = payload.new as FreeCoinClaim;
          if (!row?.id || seen.current.has(row.id)) return;
          seen.current.add(row.id);
          setRows((cur) => [row, ...cur].slice(0, limit));
          setNow(Date.now());
          toast(
            `@${row.username || "someone"} got ${row.coins_given ?? FREE_COINS_AMOUNT} free coins via Venmo 🪙`,
          );
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [limit]);

  const stats = useMemo(() => freeCoinStats(rows, new Date(now)), [rows, now]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-extrabold">Free Coins Claims</h2>
          <p className="text-xs text-muted-foreground">
            Live feed of everyone claiming the daily Venmo drop.
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Refresh claims"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard
          label="Today"
          value={stats.todayCount.toLocaleString()}
          hint={`${stats.todayCoins.toLocaleString()} coins given`}
          icon={<Users className="h-3.5 w-3.5" />}
        />
        <StatCard
          label="All time"
          value={stats.totalCount.toLocaleString()}
          hint={`${stats.totalCoins.toLocaleString()} coins given`}
          icon={<Coins className="h-3.5 w-3.5" />}
        />
      </div>

      {stats.topClaimers.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
            <Crown className="h-3.5 w-3.5" /> Top claimers
          </div>
          <ol className="mt-3 space-y-2">
            {stats.topClaimers.map((claimer, index) => (
              <li key={claimer.userId} className="flex items-center gap-3 text-sm">
                <span className="w-4 text-xs font-extrabold text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1 truncate font-bold">@{claimer.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {claimer.claims} claim{claimer.claims === 1 ? "" : "s"} ·{" "}
                  {claimer.coins.toLocaleString()} coins
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <div className="rounded-2xl border border-border bg-card p-4">
        {error ? (
          <p className="py-6 text-center text-sm text-destructive">{error}</p>
        ) : loading && rows.length === 0 ? (
          <p className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading claims…
          </p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No claims yet — share the link.
          </p>
        ) : (
          <ul>
            {rows.map((row) => (
              <ClaimRow key={row.id} row={row} now={now} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
