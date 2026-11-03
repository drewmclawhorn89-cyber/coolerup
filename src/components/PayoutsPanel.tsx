/**
 * Admin payout queue.
 *
 * One row per cashout request: who asked, what they have, what they asked for,
 * and whether it has been sent. Nothing here moves money by itself — an admin
 * opens Venmo (pre-filled with the creator's handle and the exact amount), sends
 * it, then confirms so the request is marked paid with an audit trail.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Banknote,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  RefreshCw,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { resolveAvatarUrl } from "@/components/EditProfileDialog";
import {
  adminMarkPayoutPaid,
  adminPayoutStats,
  adminPayouts,
  formatDiamonds,
  formatUsd,
  venmoPayoutUrl,
  type AdminPayoutRow,
  type PayoutStats,
} from "@/lib/payouts";

type Filter = "all" | "pending" | "paid";

const EMPTY_STATS: PayoutStats = {
  pendingCount: 0,
  paidCount: 0,
  requestedAmount: 0,
  paidAmount: 0,
};

export function PayoutsPanel() {
  const [rows, setRows] = useState<AdminPayoutRow[]>([]);
  const [stats, setStats] = useState<PayoutStats>(EMPTY_STATS);
  const [filter, setFilter] = useState<Filter>("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<AdminPayoutRow | null>(null);
  const [working, setWorking] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRows, nextStats] = await Promise.all([adminPayouts(200), adminPayoutStats()]);
      setRows(nextRows);
      setStats(nextStats);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load payouts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-payouts")
      .on("postgres_changes", { event: "*", schema: "public", table: "payouts" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  // Avatars live in a private bucket, so they need signed URLs.
  useEffect(() => {
    let cancelled = false;
    const missing = rows.filter((r) => r.avatarUrl && !avatars[r.userId]);
    if (missing.length === 0) return;
    void (async () => {
      const next: Record<string, string> = {};
      for (const row of missing.slice(0, 40)) {
        const url = await resolveAvatarUrl(row.avatarUrl);
        if (url) next[row.userId] = url;
      }
      if (!cancelled && Object.keys(next).length > 0) {
        setAvatars((prev) => ({ ...prev, ...next }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [rows, avatars]);

  const visible = useMemo(
    () => (filter === "all" ? rows : rows.filter((r) => r.status === filter)),
    [rows, filter],
  );

  const payViaVenmo = (row: AdminPayoutRow) => {
    const handle = row.method === "venmo" ? row.destination : null;
    if (!handle) {
      toast.error("This request has no Venmo handle");
      return;
    }
    window.open(venmoPayoutUrl(handle, row.amount), "_blank", "noopener,noreferrer");
    setConfirming(row);
  };

  const markPaid = async (row: AdminPayoutRow) => {
    setWorking(row.id);
    const result = await adminMarkPayoutPaid(
      row.id,
      `${row.method === "venmo" ? "Venmo" : "Stripe"} to ${row.destination ?? "creator"}`,
    );
    setWorking(null);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't mark it paid");
      return;
    }
    setConfirming(null);
    toast.success(`Marked ${formatUsd(row.amount)} paid`);
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          icon={<Clock className="h-4 w-4" />}
          label="Pending"
          value={String(stats.pendingCount)}
        />
        <Stat
          icon={<Banknote className="h-4 w-4" />}
          label="Requested"
          value={formatUsd(stats.requestedAmount)}
        />
        <Stat
          icon={<CheckCircle2 className="h-4 w-4" />}
          label="Paid out"
          value={formatUsd(stats.paidAmount)}
        />
        <Stat
          icon={<Users className="h-4 w-4" />}
          label="Paid count"
          value={String(stats.paidCount)}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-1 rounded-full bg-white/5 p-1">
          {(["all", "pending", "paid"] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${
                filter === f ? "bg-white text-black" : "text-white/60 hover:text-white"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load()}
          disabled={loading}
          className="gap-1.5 text-white/70"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>

      {error ? (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-2xl border border-white/10">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="bg-white/[0.04] text-[11px] uppercase tracking-wide text-white/45">
            <tr>
              <th className="px-3 py-2.5 font-medium">Creator</th>
              <th className="px-3 py-2.5 font-medium">Diamonds</th>
              <th className="px-3 py-2.5 font-medium">Real balance</th>
              <th className="px-3 py-2.5 font-medium">Views</th>
              <th className="px-3 py-2.5 font-medium">Requested</th>
              <th className="px-3 py-2.5 font-medium">Status</th>
              <th className="px-3 py-2.5 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {loading && rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-white/50">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" aria-hidden="true" />
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-white/50">
                  No payout requests yet.
                </td>
              </tr>
            ) : (
              visible.map((row) => (
                <tr key={row.id} className="align-middle">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      {avatars[row.userId] ? (
                        <img
                          src={avatars[row.userId]}
                          alt=""
                          className="h-7 w-7 rounded-full object-cover"
                        />
                      ) : (
                        <div className="h-7 w-7 rounded-full bg-white/10" aria-hidden="true" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate font-medium">@{row.username}</p>
                        <p className="truncate text-[11px] text-white/40">
                          {row.displayName ?? "Creator"}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-white/80">
                    {formatDiamonds(row.currentDiamonds)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-emerald-300">
                    {formatUsd(row.currentRealBalance)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums text-white/60">
                    {formatDiamonds(row.totalViews)}
                  </td>
                  <td className="px-3 py-2.5">
                    <p className="font-semibold tabular-nums">{formatUsd(row.amount)}</p>
                    <p className="text-[11px] text-white/40">
                      {row.method === "venmo" ? "Venmo" : "Stripe"}
                      {row.destination ? ` · ${row.destination}` : ""}
                    </p>
                  </td>
                  <td className="px-3 py-2.5">
                    <StatusPill status={row.status} />
                  </td>
                  <td className="px-3 py-2.5">
                    {row.status === "paid" ? (
                      <span className="text-[11px] text-white/40">
                        {row.paidAt ? new Date(row.paidAt).toLocaleDateString() : "Paid"}
                      </span>
                    ) : row.method === "venmo" ? (
                      <Button
                        size="sm"
                        onClick={() => payViaVenmo(row)}
                        disabled={working === row.id}
                        className="gap-1 bg-[#008cff] text-white hover:bg-[#0077d9]"
                      >
                        <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /> Pay via Venmo
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setConfirming(row)}
                        disabled={working === row.id}
                        className="border-white/20 text-white/80"
                      >
                        Mark paid
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Dialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent className="border-white/10 bg-[#141018] text-white">
          <DialogHeader>
            <DialogTitle>Did you send the money?</DialogTitle>
            <DialogDescription className="text-white/60">
              {confirming
                ? `${formatUsd(confirming.amount)} to @${confirming.username}${
                    confirming.destination ? ` (${confirming.destination})` : ""
                  }. Marking it paid records who paid and when.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              Not yet
            </Button>
            <Button
              onClick={() => confirming && void markPaid(confirming)}
              disabled={!confirming || working === confirming.id}
            >
              {working ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Yes, mark paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Stat({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function StatusPill({ status }: { status: AdminPayoutRow["status"] }) {
  if (status === "paid") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-300">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" /> Paid
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-300">
        Rejected
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-300">
      <Clock className="h-3 w-3" aria-hidden="true" /> Pending
    </span>
  );
}
