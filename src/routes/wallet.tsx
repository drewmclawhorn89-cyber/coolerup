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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  PAYOUT_METHODS,
  amountToPayout,
  canRequestPayout,
  formatDiamonds,
  formatUsd,
  myEarningsSummary,
  myGiftEarnings,
  myPayouts,
  notifyWalletChanged,
  requestPayout,
  useWallet,
  type EarningsSummary,
  type GiftEarning,
  type PayoutMethod,
  type PayoutRow,
} from "@/lib/payouts";
import { DEFAULT_VENMO_RECIPIENT, venmoProfileUrl } from "@/lib/venmo";

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

  const [sheetOpen, setSheetOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PayoutMethod>("venmo");
  const [destination, setDestination] = useState("");
  const [requesting, setRequesting] = useState(false);

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

  const openSheet = () => {
    setAmount(cashable.toFixed(2));
    setDestination("");
    setSheetOpen(true);
  };

  const submit = async () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value < MIN_PAYOUT) {
      toast.error(`The minimum cashout is ${formatUsd(MIN_PAYOUT)}`);
      return;
    }
    setRequesting(true);
    const result = await requestPayout({ amount: value, method, destination });
    setRequesting(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't request a payout");
      return;
    }
    toast.success(`${formatUsd(result.amount ?? value)} cashout requested`, {
      description: "We'll pay you manually and mark it paid in your history.",
    });
    setSheetOpen(false);
    notifyWalletChanged();
    await Promise.all([wallet.refresh(), load()]);
    if (method === "venmo") {
      window.open(venmoProfileUrl(DEFAULT_VENMO_RECIPIENT), "_blank", "noopener,noreferrer");
    }
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
          onClick={openSheet}
          disabled={!ready}
          className="flex items-center justify-center gap-2 rounded-xl bg-[#fe2c55] px-4 py-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40"
        >
          <Banknote className="h-4 w-4" aria-hidden="true" />
          {ready ? "Cash out" : `${formatUsd(remaining)} to ${formatUsd(MIN_PAYOUT)}`}
        </button>
        <Link
          to="/coins/recharge"
          className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
        >
          <Coins className="h-4 w-4" aria-hidden="true" /> Buy coins
        </Link>
      </div>

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

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="border-white/10 bg-[#141018] text-white">
          <DialogHeader>
            <DialogTitle>Cash out</DialogTitle>
            <DialogDescription className="text-white/60">
              {formatUsd(cashable)} cashable · {formatUsd(MIN_PAYOUT)} minimum. Payouts are sent
              manually, usually within a couple of days.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label htmlFor="payout-amount" className="text-xs font-medium text-white/60">
                Amount
              </label>
              <Input
                id="payout-amount"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 border-white/15 bg-black/40 text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              {PAYOUT_METHODS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMethod(m.id)}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium ${
                    method === m.id
                      ? "border-[#fe2c55] bg-[#fe2c55]/15 text-white"
                      : "border-white/15 text-white/70 hover:bg-white/5"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="payout-destination" className="text-xs font-medium text-white/60">
                {method === "venmo" ? "Venmo username" : "Stripe email"}
              </label>
              <Input
                id="payout-destination"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                placeholder={method === "venmo" ? "@your-venmo" : "you@email.com"}
                className="mt-1 border-white/15 bg-black/40 text-white"
              />
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setSheetOpen(false)} disabled={requesting}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={requesting || !ready}>
              {requesting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
              Request {formatUsd(Number(amount) || 0)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
