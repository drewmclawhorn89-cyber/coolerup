/**
 * The wallet balance card and the realtime earnings notifier.
 *
 * `WalletBalance` is the single place the app renders "how much do I have":
 * diamonds (what gifts earn you) and real balance (USD from the creator fund
 * and follower rewards), plus what those two add up to at cashout.
 *
 * `EarningsWatcher` is mounted once at the root. It listens for new gift claims
 * and creator-fund awards and pops a toast, so a creator sees money arrive even
 * while they are watching someone else's video.
 */
import { useEffect, useRef } from "react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { Gem, Wallet as WalletIcon, ArrowUpRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  amountToPayout,
  canRequestPayout,
  formatDiamonds,
  formatUsd,
  useWallet,
} from "@/lib/payouts";

type WalletBalanceProps = {
  /** Hide the "Cash out" link when the card is already inside the wallet. */
  showCashout?: boolean;
  className?: string;
};

export function WalletBalance({ showCashout = true, className = "" }: WalletBalanceProps) {
  const { user, ready } = useAuth();
  const wallet = useWallet(user?.id);

  const ready_ = canRequestPayout(wallet.cashable);
  const remaining = amountToPayout(wallet.cashable);

  return (
    <section
      className={`rounded-2xl border border-white/10 bg-gradient-to-br from-[#1b1230] to-[#0b0714] p-4 ${className}`}
      aria-label="Wallet balance"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-white/50">
            <Gem className="h-3.5 w-3.5" aria-hidden="true" /> Diamonds
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-white">
            {ready ? formatDiamonds(wallet.diamonds) : "—"}
          </p>
          <p className="text-xs text-white/40">
            {ready ? `${formatUsd(wallet.diamonds * 0.01)} at cashout` : "Loading"}
          </p>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-1.5 text-xs font-medium uppercase tracking-wide text-white/50">
            <WalletIcon className="h-3.5 w-3.5" aria-hidden="true" /> Real balance
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-emerald-300">
            {ready ? formatUsd(wallet.realBalance) : "—"}
          </p>
          <p className="text-xs text-white/40">
            {ready ? `${formatUsd(wallet.totalEarned)} earned all time` : "Loading"}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-black/30 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs text-white/50">Cashable now</p>
          <p className="text-lg font-semibold tabular-nums text-white">
            {ready ? formatUsd(wallet.cashable) : "—"}
          </p>
        </div>
        {showCashout ? (
          ready_ ? (
            <Link
              to="/wallet"
              className="inline-flex items-center gap-1 rounded-full bg-[#fe2c55] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#e0264c]"
            >
              Cash out <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          ) : (
            <p className="text-right text-xs text-white/40">
              {ready ? `${formatUsd(remaining)} to the $10 minimum` : ""}
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}

/**
 * Realtime money toasts. Mounted once at the root; safe to mount twice because
 * it only ever reacts to database inserts, never writes anything.
 */
export function EarningsWatcher() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`earnings-toast:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "gift_claims", filter: `user_id=eq.${userId}` },
        (payload) => {
          const row = payload.new as { id?: string; diamonds?: number; amount?: number };
          const id = String(row.id ?? "");
          if (id && seen.current.has(id)) return;
          if (id) seen.current.add(id);
          const amount = Number(row.amount ?? 0);
          toast.success(`You earned ${formatUsd(amount)} from a gift 💎`, {
            description: `${formatDiamonds(Number(row.diamonds ?? 0))} diamonds added to your wallet`,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "creator_fund_earnings",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { id?: string; amount?: number; milestone_views?: number };
          const id = String(row.id ?? "");
          if (id && seen.current.has(id)) return;
          if (id) seen.current.add(id);
          toast.success(`Creator fund: ${formatUsd(Number(row.amount ?? 0))} earned 🎉`, {
            description: `You passed ${formatDiamonds(Number(row.milestone_views ?? 0))} views`,
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  return null;
}
