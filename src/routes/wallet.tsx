import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  Coins,
  Gem,
  Gift,
  Loader2,
  Sparkles,
  Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { WalletBalance } from "@/components/WalletBalance";
import { useAuth } from "@/hooks/useAuth";
import { useCoins } from "@/lib/coins";
import {
  CREATOR_FUND_MILESTONES,
  formatViews,
  myCreatorFund,
  type CreatorFund,
} from "@/lib/creatorFund";
import {
  MIN_PAYOUT,
  amountToPayout,
  canRequestPayout,
  formatDiamonds,
  formatUsd,
  myEarningsSummary,
  myGiftEarnings,
  myPayouts,
  notifyWalletChanged,
  requestPayout,
  setMyVenmoHandle,
  useWallet,
  type EarningsSummary,
  type GiftEarning,
  type PayoutRow,
} from "@/lib/payouts";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Coolerup" },
      {
        name: "description",
        content:
          "Your diamonds, real creator-fund balance, gift earnings and cashouts, all in one wallet.",
      },
      { property: "og:title", content: "Wallet — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WalletPage,
});

const EMPTY_SUMMARY: EarningsSummary = {
  giftDiamonds: 0,
  giftUsd: 0,
  creatorFundUsd: 0,
  followerRewardUsd: 0,
  diamonds: 0,
  realBalance: 0,
  totalEarned: 0,
  cashable: 0,
};

function WalletPage() {
  const auth = useAuth();
  const coins = useCoins(auth.user?.id);
  const wallet = useWallet(auth.user?.id);

  const [summary, setSummary] = useState<EarningsSummary>(EMPTY_SUMMARY);
  const [gifts, setGifts] = useState<GiftEarning[]>([]);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [fund, setFund] = useState<CreatorFund | null>(null);
  const [loading, setLoading] = useState(true);

  const [cashingOut, setCashingOut] = useState(false);
  const [editingHandle, setEditingHandle] = useState(false);
  const [handleDraft, setHandleDraft] = useState("");
  const [savingHandle, setSavingHandle] = useState(false);

  const load = useCallback(async () => {
    if (!auth.user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const [nextSummary, nextGifts, nextPayouts, nextFund] = await Promise.all([
      myEarningsSummary(),
      myGiftEarnings(50),
      myPayouts(50),
      myCreatorFund(),
    ]);
    setSummary(nextSummary);
    setGifts(nextGifts);
    setPayouts(nextPayouts);
    setFund(nextFund);
    setLoading(false);
  }, [auth.user]);

  useEffect(() => {
    void load();
  }, [load]);

  const cashable = wallet.cashable;
  const ready = canRequestPayout(cashable);
  const remaining = amountToPayout(cashable);

  /**
   * One tap: the database pays the whole cashable balance to the creator's own
   * saved Venmo handle. No dialog, no popup, no second screen.
   */
  const cashOut = async () => {
    if (!ready || cashingOut) return;
    setCashingOut(true);
    const result = await requestPayout({});
    setCashingOut(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't request a payout");
      // The only thing we can fix from here is a missing handle, so reveal the
      // inline field instead of a modal.
      if (result.error === "Add your Venmo username first") setEditingHandle(true);
      return;
    }
    toast.success(`${formatUsd(result.amount ?? cashable)} on the way to your Venmo`, {
      description: result.destination ? `Sending to @${result.destination}` : undefined,
    });
    notifyWalletChanged();
    await Promise.all([wallet.refresh(), load()]);
  };

  const saveHandle = async () => {
    setSavingHandle(true);
    const result = await setMyVenmoHandle(handleDraft);
    setSavingHandle(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't save your Venmo username");
      return;
    }
    setEditingHandle(false);
    toast.success(result.venmoHandle ? `Cashouts go to @${result.venmoHandle}` : "Venmo removed");
    await wallet.refresh();
  };

  const pending = useMemo(() => payouts.filter((p) => p.status === "pending"), [payouts]);

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl bg-black px-4 pb-24 pt-4 text-white">
      <header className="mb-4 flex items-center gap-2">
        <Link to="/" className="rounded-full p-2 hover:bg-white/10" aria-label="Back to the feed">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Wallet</h1>
          <p className="text-xs text-white/50">Diamonds, earnings and cashouts</p>
        </div>
        <Link
          to="/creator"
          className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
        >
          Creator dashboard
        </Link>
      </header>

      <WalletBalance showCashout={false} />

      <div className="mt-3 grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => void cashOut()}
          disabled={!ready || cashingOut}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#fe2c55] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
        >
          {cashingOut ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Banknote className="h-4 w-4" aria-hidden="true" />
          )}
          {ready
            ? `Cash out ${formatUsd(cashable)}`
            : `${formatUsd(remaining)} to ${formatUsd(MIN_PAYOUT)}`}
        </button>
        <Link
          to="/coins/recharge"
          className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
        >
          <Coins className="h-4 w-4" aria-hidden="true" /> Buy coins
        </Link>
      </div>

      <section className="mt-3 rounded-xl border border-white/10 bg-white/[0.03] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] uppercase tracking-wide text-white/40">Cashouts go to</p>
            <p className="truncate text-sm font-medium">
              {wallet.venmoHandle ? `Venmo @${wallet.venmoHandle}` : "No Venmo username yet"}
            </p>
          </div>
          {editingHandle ? null : (
            <button
              type="button"
              onClick={() => {
                setHandleDraft(wallet.venmoHandle ?? "");
                setEditingHandle(true);
              }}
              className="shrink-0 rounded-full border border-white/15 px-3 py-1.5 text-xs font-medium text-white/80 hover:bg-white/10"
            >
              {wallet.venmoHandle ? "Change" : "Add"}
            </button>
          )}
        </div>
        {editingHandle ? (
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={handleDraft}
              onChange={(e) => setHandleDraft(e.target.value)}
              placeholder="@your-venmo"
              autoFocus
              className="border-white/15 bg-black/40 text-white"
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveHandle();
              }}
            />
            <Button onClick={() => void saveHandle()} disabled={savingHandle} className="shrink-0">
              {savingHandle ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : null}
              Save
            </Button>
          </div>
        ) : null}
      </section>

      <Tabs defaultValue="earnings" className="mt-5">
        <TabsList className="grid w-full grid-cols-3 bg-white/5">
          <TabsTrigger value="earnings">Earnings</TabsTrigger>
          <TabsTrigger value="gifts">Gifts</TabsTrigger>
          <TabsTrigger value="fund">Creator Fund</TabsTrigger>
        </TabsList>

        <TabsContent value="earnings" className="mt-4 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Stat
              icon={<Gift className="h-4 w-4" />}
              label="From gifts"
              value={formatUsd(summary.giftUsd)}
              hint={`${formatDiamonds(summary.giftDiamonds)} diamonds`}
            />
            <Stat
              icon={<Sparkles className="h-4 w-4" />}
              label="Creator fund"
              value={formatUsd(summary.creatorFundUsd)}
              hint="Per-view milestones"
            />
            <Stat
              icon={<Gem className="h-4 w-4" />}
              label="Follower reward"
              value={formatUsd(summary.followerRewardUsd)}
              hint="First-follower bonus"
            />
            <Stat
              icon={<WalletIcon className="h-4 w-4" />}
              label="Total earned"
              value={formatUsd(summary.totalEarned)}
              hint="All time"
            />
          </div>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Clock className="h-4 w-4 text-white/60" aria-hidden="true" /> Payout history
            </h2>
            {loading ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
              </p>
            ) : payouts.length === 0 ? (
              <p className="mt-3 text-sm text-white/50">
                No cashouts yet. You need {formatUsd(MIN_PAYOUT)} of cashable balance to request
                one.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-white/5">
                {payouts.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium tabular-nums">{formatUsd(p.amount)}</p>
                      <p className="truncate text-xs text-white/45">
                        {p.method === "venmo" ? "Venmo" : "Stripe"}
                        {p.destination ? ` · ${p.destination}` : ""} ·{" "}
                        {new Date(p.requestedAt).toLocaleDateString()}
                      </p>
                    </div>
                    <StatusPill status={p.status} />
                  </li>
                ))}
              </ul>
            )}
            {pending.length > 0 ? (
              <p className="mt-3 text-xs text-amber-300/80">
                {pending.length} cashout{pending.length === 1 ? "" : "s"} waiting on review.
              </p>
            ) : null}
          </section>

          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="text-sm font-semibold">Coins</h2>
            <p className="mt-1 text-sm text-white/60">
              {formatDiamonds(coins.balance)} coins available to spend on gifts in LIVE.
            </p>
            <Link
              to="/coins/recharge"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#25f4ee]"
            >
              Top up coins <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </section>
        </TabsContent>

        <TabsContent value="gifts" className="mt-4">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Gift className="h-4 w-4 text-white/60" aria-hidden="true" /> Gifts you received
            </h2>
            {loading ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-white/50">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…
              </p>
            ) : gifts.length === 0 ? (
              <p className="mt-3 text-sm text-white/50">
                No gifts yet. Go LIVE — every gift becomes diamonds, and 100 diamonds is{" "}
                {formatUsd(1)}.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-white/5">
                {gifts.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {g.giftType}
                        {g.quantity > 1 ? ` ×${g.quantity}` : ""} from @
                        {g.senderUsername ?? "someone"}
                      </p>
                      <p className="text-xs text-white/45">
                        {g.coins} coins · {new Date(g.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-emerald-300">
                        +{formatUsd(g.amount)}
                      </p>
                      <p className="text-xs text-white/45">{formatDiamonds(g.diamonds)} 💎</p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </TabsContent>

        <TabsContent value="fund" className="mt-4 space-y-4">
          <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold">Creator fund</h2>
                <p className="mt-1 text-xs text-white/50">
                  {fund?.qualified
                    ? "You're qualified — milestones pay out automatically."
                    : "10 followers and 10K views in 30 days to qualify."}
                </p>
              </div>
              <p className="text-right text-lg font-semibold tabular-nums text-emerald-300">
                {formatUsd(fund?.earned ?? 0)}
              </p>
            </div>
            <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg bg-black/30 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-white/40">Views</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {formatViews(fund?.totalViews ?? 0)}
                </dd>
              </div>
              <div className="rounded-lg bg-black/30 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-white/40">30-day</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {formatViews(fund?.views30d ?? 0)}
                </dd>
              </div>
              <div className="rounded-lg bg-black/30 py-2">
                <dt className="text-[10px] uppercase tracking-wide text-white/40">Followers</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {formatDiamonds(fund?.followers ?? 0)}
                </dd>
              </div>
            </dl>
            <ul className="mt-3 space-y-1.5">
              {CREATOR_FUND_MILESTONES.map((m) => {
                const paid = (fund?.earnings ?? []).some((e) => e.milestoneViews === m.views);
                const reached = (fund?.totalViews ?? 0) >= m.views;
                return (
                  <li
                    key={m.views}
                    className="flex items-center justify-between rounded-lg bg-black/20 px-3 py-2 text-sm"
                  >
                    <span className="flex items-center gap-2 text-white/70">
                      {paid ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                      ) : (
                        <Gem className="h-4 w-4 text-white/30" aria-hidden="true" />
                      )}
                      {formatViews(m.views)} views
                    </span>
                    <span
                      className={
                        paid
                          ? "font-semibold text-emerald-300"
                          : reached
                            ? "text-white"
                            : "text-white/40"
                      }
                    >
                      {formatUsd(m.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {(fund?.videos ?? []).some((v) => v.views > 0) ? (
              <div className="mt-4">
                <p className="text-[10px] uppercase tracking-wide text-white/40">
                  Earnings by video
                </p>
                <ul className="mt-1.5 space-y-1.5">
                  {(fund?.videos ?? [])
                    .filter((v) => v.views > 0)
                    .slice(0, 5)
                    .map((v) => (
                      <li
                        key={v.videoId}
                        className="flex items-center justify-between gap-3 rounded-lg bg-black/20 px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-sm text-white/70">
                          {v.videoUsername ? `@${v.videoUsername}` : "Video"} got{" "}
                          {formatViews(v.views)} views
                        </span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-emerald-300">
                          {formatUsd(v.earnings)}
                        </span>
                      </li>
                    ))}
                </ul>
              </div>
            ) : null}
            <Link
              to="/creator"
              className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-[#25f4ee]"
            >
              Open creator dashboard <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </section>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/45">
        {icon}
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-[11px] text-white/40">{hint}</p>
    </div>
  );
}

function StatusPill({ status }: { status: PayoutRow["status"] }) {
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
