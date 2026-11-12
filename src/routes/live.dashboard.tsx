import { useCallback, useEffect, useMemo, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Coins,
  Diamond,
  Gift,
  Loader2,
  Sparkles,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  earningsFromCoins,
  giftById,
  MIN_CASHOUT_DIAMONDS,
  tickerLine,
  usdFromCents,
  useCoins,
  type GiftFeedRow,
} from "@/lib/coins";
import { requestCashout } from "@/lib/coins.functions";

export const Route = createFileRoute("/live/dashboard")({
  head: () => ({
    meta: [
      { title: "Gift dashboard — Coolerup" },
      { name: "description", content: "See the coins and diamonds you earned from LIVE gifts." },
    ],
  }),
  component: LiveDashboardPage,
});

type TodayGift = GiftFeedRow & { receiver_id?: string };

function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Streamer-side earnings.
 *
 * Coins arrive from `live_gifts` rows where receiver_id = me. The wallet row
 * holds the lifetime totals and the diamond balance that can be cashed out.
 * 100 coins = 50 diamonds = $0.50, so a diamond is one cent.
 */
function LiveDashboardPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const wallet = useCoins(auth.user?.id);
  const [today, setToday] = useState<TodayGift[] | null>(null);
  const [recent, setRecent] = useState<TodayGift[]>([]);
  const [cashingOut, setCashingOut] = useState(false);

  const loadGifts = useCallback(async () => {
    const userId = auth.user?.id;
    if (!userId) {
      setToday([]);
      setRecent([]);
      return;
    }
    const { data, error } = await supabase
      .from("live_gifts")
      .select(
        "id, gift_type, coins, quantity, sender_id, receiver_id, created_at, sender:profiles!live_gifts_sender_id_fkey(handle, username, avatar_url)",
      )
      .eq("receiver_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      console.error(error);
      setToday([]);
      setRecent([]);
      return;
    }

    const rows = (data ?? []) as unknown as TodayGift[];
    const since = startOfToday().getTime();
    setToday(rows.filter((row) => new Date(row.created_at).getTime() >= since));
    setRecent(rows.slice(0, 12));
  }, [auth.user?.id]);

  useEffect(() => {
    void loadGifts();
  }, [loadGifts]);

  const todayCoins = useMemo(
    () => (today ?? []).reduce((sum, row) => sum + Number(row.coins || 0), 0),
    [today],
  );
  const todayEarnings = earningsFromCoins(todayCoins);
  const lifetimeCoins = Number(wallet.totalEarned ?? 0);
  const lifetimeEarnings = earningsFromCoins(lifetimeCoins);
  const diamonds = Number(wallet.diamonds ?? 0);
  const cashValue = usdFromCents(diamonds);
  const canCashOut = diamonds >= MIN_CASHOUT_DIAMONDS;

  const cashOut = async () => {
    if (!auth.user) {
      toast.error("Sign in to cash out");
      return;
    }
    setCashingOut(true);
    try {
      const result = await requestCashout({ data: { diamonds } });
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(`Cashout requested — ${usdFromCents(result.cents)} on the way`);
      await wallet.refresh();
      await loadGifts();
    } catch (error) {
      console.error(error);
      toast.error("Couldn't request a cashout");
    } finally {
      setCashingOut(false);
    }
  };

  return (
    <div className="min-h-dvh bg-black pb-24 text-white">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/10 bg-black/85 px-4 py-3 backdrop-blur-xl">
        <button
          type="button"
          onClick={() => navigate({ to: "/" })}
          aria-label="Back"
          className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/15"
        >
          <ArrowLeft className="size-4" />
        </button>
        <div className="min-w-0">
          <h1 className="truncate text-base font-bold">Gift dashboard</h1>
          <p className="truncate text-xs text-white/55">
            {auth.handle ? `@${auth.handle}` : "Your LIVE earnings"}
          </p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl space-y-4 px-4 pt-4">
        <section className="rounded-3xl bg-gradient-to-br from-[#fe2c55] via-[#e11d48] to-[#7c2d12] p-5 shadow-lg shadow-[#fe2c55]/25">
          <p className="text-xs font-semibold uppercase tracking-wide text-white/75">Today</p>
          <p className="mt-1 text-2xl font-black leading-tight" data-testid="dashboard-today">
            You received {todayCoins.toLocaleString()} coins today — {todayEarnings.usd}
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2 text-center">
            <Stat label="Coins" value={todayCoins.toLocaleString()} />
            <Stat label="Diamonds" value={todayEarnings.diamonds.toLocaleString()} />
            <Stat label="Gifts" value={(today ?? []).length.toLocaleString()} />
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-white/60">
              <Coins className="size-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Coins balance</span>
            </div>
            <p className="mt-2 text-xl font-bold">{(wallet.balance ?? 0).toLocaleString()}</p>
            <p className="text-xs text-white/45">Spendable on gifts</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-white/60">
              <Diamond className="size-4" />
              <span className="text-xs font-semibold uppercase tracking-wide">Diamonds</span>
            </div>
            <p className="mt-2 text-xl font-bold">{diamonds.toLocaleString()}</p>
            <p className="text-xs text-white/45">Worth {cashValue}</p>
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-white/60">
                <TrendingUp className="size-4" />
                <span className="text-xs font-semibold uppercase tracking-wide">Lifetime</span>
              </div>
              <p className="mt-2 text-lg font-bold">
                {lifetimeCoins.toLocaleString()} coins · {lifetimeEarnings.usd}
              </p>
              <p className="mt-1 text-xs text-white/45">
                100 coins = 50 diamonds = $0.50. Minimum cashout {MIN_CASHOUT_DIAMONDS} diamonds.
              </p>
            </div>
            <Button
              type="button"
              onClick={cashOut}
              disabled={cashingOut || !canCashOut}
              className="shrink-0 bg-[#fe2c55] font-bold text-white hover:bg-[#e11d48] disabled:bg-white/10 disabled:text-white/40"
            >
              {cashingOut ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wallet className="size-4" />
              )}
              <span className="ml-1.5">Cash out</span>
            </Button>
          </div>
          {!canCashOut && (
            <p className="mt-3 rounded-xl bg-yellow-400/10 px-3 py-2 text-xs text-yellow-200">
              {Math.max(0, MIN_CASHOUT_DIAMONDS - diamonds).toLocaleString()} more diamonds to
              unlock cashout.
            </p>
          )}
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-bold">
              <Gift className="size-4 text-[#fe2c55]" /> Recent gifts
            </h2>
            <Link
              to="/coins/recharge"
              className="text-xs font-semibold text-[#fe2c55] hover:underline"
            >
              Buy coins
            </Link>
          </div>

          {recent.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm text-white/50">
              <Sparkles className="size-4" /> No gifts yet — go LIVE and your fans can send roses.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-white/5">
              {recent.map((row) => {
                const gift = giftById(row.gift_type);
                return (
                  <li key={row.id} className="flex items-center gap-3 py-2.5">
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-lg">
                      {gift?.emoji ?? "🎁"}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{tickerLine(row)}</p>
                      <p className="truncate text-xs text-white/45">
                        {new Date(row.created_at).toLocaleString()}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[#fe2c55]/15 px-2 py-1 text-xs font-bold text-[#fe2c55]">
                      +{Number(row.coins).toLocaleString()} 🪙
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <p className="px-1 pb-4 text-center text-[11px] leading-relaxed text-white/35">
          Diamonds are Coolerup's payout unit. Cashouts are reviewed before payout, and gift
          purchases are non-refundable.
        </p>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-black/25 px-2 py-2">
      <p className="text-base font-bold leading-tight">{value}</p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-white/65">{label}</p>
    </div>
  );
}
