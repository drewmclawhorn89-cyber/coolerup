/**
 * Admin payout queue for the creator fund.
 *
 * Every row is one account that reached its first follower and earned $1.00.
 * There is no payout API, so an admin sends the money in Venmo and then marks
 * the row paid — which is the audit trail (`claimed`, `paid_at`, `paid_by`).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Banknote, Check, Clock, ExternalLink, RefreshCw, Send, Users } from "lucide-react";
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
import {
  adminFollowerPayouts,
  adminMarkPayoutPaid,
  formatRealMoney,
  venmoCashoutUrl,
  type AdminPayout,
} from "@/lib/follow";
import { resolveAvatarUrl } from "@/components/EditProfileDialog";

type Filter = "all" | "requested" | "pending" | "paid";

const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "—";

function Avatar({ row }: { row: AdminPayout }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    resolveAvatarUrl(row.avatar_url).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [row.avatar_url]);

  if (src) {
    return <img src={src} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" />;
  }
  return (
    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold uppercase text-muted-foreground">
      {row.username.slice(0, 2)}
    </div>
  );
}

export function PayoutsPanel() {
  const [rows, setRows] = useState<AdminPayout[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [paying, setPaying] = useState<AdminPayout | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await adminFollowerPayouts(300));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load payouts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const channel = supabase
      .channel("follower-payouts:admin")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "follower_rewards" },
        () => void refresh(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [refresh]);

  const stats = useMemo(() => {
    const paid = rows.filter((r) => r.claimed);
    const requested = rows.filter((r) => !r.claimed && r.payout_requested_at);
    return {
      total: rows.length,
      paidCount: paid.length,
      paidAmount: paid.reduce((sum, r) => sum + Number(r.reward_amount), 0),
      requestedCount: requested.length,
      pendingCount: rows.length - paid.length,
    };
  }, [rows]);

  const visible = useMemo(() => {
    if (filter === "paid") return rows.filter((r) => r.claimed);
    if (filter === "requested") return rows.filter((r) => !r.claimed && r.payout_requested_at);
    if (filter === "pending") return rows.filter((r) => !r.claimed);
    return rows;
  }, [rows, filter]);

  async function openVenmo(row: AdminPayout) {
    const handle = row.payout_venmo_handle || row.username;
    window.open(
      venmoCashoutUrl(handle, Number(row.reward_amount)),
      "_blank",
      "noopener,noreferrer",
    );
    setPaying(row);
  }

  async function markPaid(row: AdminPayout) {
    setBusy(row.id);
    try {
      const res = await adminMarkPayoutPaid(
        row.id,
        `Venmo to @${row.payout_venmo_handle || row.username}`,
      );
      if (!res.ok) {
        toast.error(res.error ?? "Couldn't mark it paid");
        return;
      }
      toast.success(
        `Marked ${formatRealMoney(Number(row.reward_amount))} paid to @${row.username}`,
      );
      setPaying(null);
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Rewards" value={String(stats.total)} icon={<Users className="h-4 w-4" />} />
        <Stat
          label="Requested"
          value={String(stats.requestedCount)}
          icon={<Clock className="h-4 w-4 text-amber-500" />}
        />
        <Stat
          label="Unpaid"
          value={String(stats.pendingCount)}
          icon={<Banknote className="h-4 w-4 text-primary" />}
        />
        <Stat
          label="Paid out"
          value={formatRealMoney(stats.paidAmount)}
          icon={<Check className="h-4 w-4 text-emerald-500" />}
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {(
            [
              ["all", `All (${stats.total})`],
              ["requested", `Requested (${stats.requestedCount})`],
              ["pending", `Unpaid (${stats.pendingCount})`],
              ["paid", `Paid (${stats.paidCount})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
                filter === id ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {loading && rows.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">Loading payouts…</p>
      )}

      {!loading && visible.length === 0 && (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {filter === "all"
            ? "Nobody has hit their first follower yet."
            : "Nothing in this bucket right now."}
        </p>
      )}

      <div className="space-y-2">
        {visible.map((row) => (
          <article
            key={row.id}
            className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
          >
            <Avatar row={row} />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                <span className="truncate">@{row.username}</span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                    row.claimed
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : row.payout_requested_at
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {row.claimed ? "paid" : row.payout_requested_at ? "requested" : "pending"}
                </span>
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {row.follower_count} follower{row.follower_count === 1 ? "" : "s"} ·{" "}
                {formatRealMoney(Number(row.reward_amount))} reward · real balance{" "}
                {formatRealMoney(Number(row.real_balance))}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                earned {when(row.created_at)}
                {row.payout_venmo_handle ? ` · Venmo @${row.payout_venmo_handle}` : ""}
                {row.claimed ? ` · paid ${when(row.paid_at)}` : ""}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                className="gap-1"
                onClick={() => void openVenmo(row)}
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Venmo
              </Button>
              <Button
                size="sm"
                className="gap-1"
                disabled={row.claimed || busy === row.id}
                onClick={() => void markPaid(row)}
              >
                <Send className="h-3.5 w-3.5" />
                {row.claimed ? "Paid" : "Pay"}
              </Button>
            </div>
          </article>
        ))}
      </div>

      <Dialog open={!!paying} onOpenChange={(next) => !next && setPaying(null)}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Did you send the money?</DialogTitle>
            <DialogDescription>
              Venmo should be open for {formatRealMoney(Number(paying?.reward_amount ?? 1))} to @
              {paying?.payout_venmo_handle || paying?.username}. Marking it paid records the payout
              and clears it from the queue.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setPaying(null)}>
              Not yet
            </Button>
            <Button
              onClick={() => paying && void markPaid(paying)}
              disabled={!!busy}
              className="gap-2"
            >
              <Check className="h-4 w-4" />
              Mark as paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-black">{value}</p>
    </div>
  );
}
