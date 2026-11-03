import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  Coins,
  Gem,
  Loader2,
  PartyPopper,
  Wallet as WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { useCoins } from "@/lib/coins";
import {
  FOLLOWER_REWARD_AMOUNT,
  MIN_REAL_CASHOUT,
  canCashOut,
  formatRealMoney,
  myFollowerReward,
  notifyRealBalanceChanged,
  requestFollowerPayout,
  useRealBalance,
  type FollowerReward,
} from "@/lib/follow";
import { DEFAULT_VENMO_RECIPIENT, venmoProfileUrl } from "@/lib/venmo";

export const Route = createFileRoute("/wallet")({
  head: () => ({
    meta: [
      { title: "Wallet — Coolerup" },
      {
        name: "description",
        content: "Your real creator-fund balance and Coolerup coins, all in one wallet.",
      },
      { property: "og:title", content: "Wallet — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WalletPage,
});

function WalletPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const coins = useCoins(auth.user?.id);
  const real = useRealBalance(auth.user?.id);
  const [reward, setReward] = useState<FollowerReward | null>(null);
  const [rewardLoading, setRewardLoading] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [venmoHandle, setVenmoHandle] = useState("");
  const [requesting, setRequesting] = useState(false);

  const loadReward = useCallback(async () => {
    if (!auth.user) {
      setReward(null);
      setRewardLoading(false);
      return;
    }
    try {
      const state = await myFollowerReward();
      setReward(state.reward);
    } catch {
      setReward(null);
    } finally {
      setRewardLoading(false);
    }
  }, [auth.user]);

  useEffect(() => {
    void loadReward();
  }, [loadReward]);

  const balance = real.balance ?? 0;
  const claimed = reward?.claimed ?? false;
  const requested = !!reward?.payoutRequestedAt;
  const eligible = canCashOut(balance, claimed);

  async function submitPayout() {
    setRequesting(true);
    try {
      const result = await requestFollowerPayout(venmoHandle);
      if (!result.ok) {
        toast.error(result.error ?? "Couldn't request a payout");
        return;
      }
      const handle = venmoHandle.replace(/^@+/, "");
      toast.success(
        `Payout requested — ${formatRealMoney(result.amount ?? FOLLOWER_REWARD_AMOUNT)} to @${handle}`,
      );
      setSheetOpen(false);
      await loadReward();
      await real.refresh();
      notifyRealBalanceChanged();
      // Manual payout: open the Coolerup Venmo account so the creator can see
      // who is sending the money. The admin confirms in /admin/payouts.
      window.open(venmoProfileUrl(DEFAULT_VENMO_RECIPIENT), "_blank", "noopener,noreferrer");
    } finally {
      setRequesting(false);
    }
  }

  if (!auth.ready) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background text-sm text-muted-foreground">
        Loading wallet…
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-lg bg-background pb-24">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/90 px-4 py-3 backdrop-blur">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back"
          onClick={() => void navigate({ to: "/" })}
        >
          <ArrowLeft />
        </Button>
        <h1 className="flex items-center gap-2 font-display text-lg font-extrabold">
          <WalletIcon className="h-5 w-5 text-primary" />
          Wallet
        </h1>
      </header>

      <div className="space-y-5 px-4 pt-4">
        {/* Real money ------------------------------------------------------ */}
        <section className="rounded-3xl bg-gradient-to-br from-[#0f766e] to-[#052e2b] p-5 text-white shadow-lg">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">
            Real balance
          </p>
          <p className="mt-1 text-4xl font-black tracking-tight">
            {real.balance === null ? "—" : formatRealMoney(balance)}
          </p>
          <p className="mt-1 text-xs text-white/70">
            Creator-fund cash · not coins, can&apos;t be spent on gifts
          </p>

          <div className="mt-4">
            {claimed ? (
              <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold">
                <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                Paid out
                {reward?.paidAt ? ` on ${new Date(reward.paidAt).toLocaleDateString()}` : ""}
              </div>
            ) : requested ? (
              <div className="flex items-center gap-2 rounded-2xl bg-white/10 px-4 py-3 text-sm font-semibold">
                <Clock className="h-4 w-4 text-amber-300" />
                Payout requested
                {reward?.payoutVenmoHandle ? ` to @${reward.payoutVenmoHandle}` : ""} — an admin
                sends it manually
              </div>
            ) : (
              <Button
                onClick={() => setSheetOpen(true)}
                disabled={!eligible || real.loading}
                className="w-full gap-2 bg-white text-[#052e2b] hover:bg-white/90 disabled:opacity-60"
              >
                <Banknote className="h-4 w-4" />
                Cash out via Venmo
              </Button>
            )}
          </div>

          {!claimed && !requested && !eligible && (
            <p className="mt-2 text-[11px] text-white/70">
              Minimum {formatRealMoney(MIN_REAL_CASHOUT)} to cash out.{" "}
              {reward ? "" : "Get your first follower to unlock it."}
            </p>
          )}
        </section>

        {/* Creator fund explainer ----------------------------------------- */}
        {!reward && !rewardLoading && (
          <section className="flex items-start gap-3 rounded-3xl border border-[#25f4ee]/30 bg-[#25f4ee]/5 p-4">
            <PartyPopper className="mt-0.5 h-5 w-5 shrink-0 text-[#25f4ee]" />
            <div className="min-w-0">
              <p className="text-sm font-extrabold">
                Earn {formatRealMoney(FOLLOWER_REWARD_AMOUNT)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Your first real follower pays you {formatRealMoney(FOLLOWER_REWARD_AMOUNT)} of
                cashable money — one time only, per account. Share a video to get started.
              </p>
              <Button asChild size="sm" variant="secondary" className="mt-3">
                <Link to="/">Back to the feed</Link>
              </Button>
            </div>
          </section>
        )}

        {reward && (
          <section className="rounded-3xl border border-border bg-card p-4">
            <h2 className="flex items-center gap-2 text-sm font-extrabold">
              <PartyPopper className="h-4 w-4 text-[#25f4ee]" />
              Creator fund
            </h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">First-follower reward</dt>
                <dd className="font-semibold">{formatRealMoney(reward.rewardAmount)}</dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Earned</dt>
                <dd className="font-semibold">
                  {reward.createdAt ? new Date(reward.createdAt).toLocaleDateString() : "—"}
                </dd>
              </div>
              <div className="flex items-center justify-between">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-semibold">
                  {claimed ? "Paid" : requested ? "Requested" : "Ready to cash out"}
                </dd>
              </div>
            </dl>
          </section>
        )}

        {/* Coins ----------------------------------------------------------- */}
        <section className="rounded-3xl border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-extrabold">
            <Coins className="h-4 w-4 text-primary" />
            Coins
          </h2>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Balance
              </p>
              <p className="text-2xl font-black">
                {coins.balance === null ? "—" : coins.balance.toLocaleString()}
              </p>
            </div>
            <div className="rounded-2xl bg-muted/60 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Diamonds
              </p>
              <p className="flex items-center gap-1 text-2xl font-black">
                <Gem className="h-4 w-4 text-[#25f4ee]" />
                {coins.diamonds.toLocaleString()}
              </p>
            </div>
          </div>
          <Button asChild variant="secondary" className="mt-3 w-full">
            <Link to="/coins/recharge">Buy coins</Link>
          </Button>
        </section>

        <p className="px-1 text-center text-[11px] text-muted-foreground">
          Payouts are sent manually through Venmo within 24 hours of a request.
        </p>
      </div>

      <Dialog open={sheetOpen} onOpenChange={setSheetOpen}>
        <DialogContent className="max-w-sm rounded-3xl">
          <DialogHeader>
            <DialogTitle>Cash out {formatRealMoney(balance)}</DialogTitle>
            <DialogDescription>
              Tell us your Venmo username and an admin will send the money. Minimum{" "}
              {formatRealMoney(MIN_REAL_CASHOUT)}.
            </DialogDescription>
          </DialogHeader>

          <label
            className="block text-xs font-semibold text-muted-foreground"
            htmlFor="venmo-handle"
          >
            Your Venmo username
          </label>
          <Input
            id="venmo-handle"
            value={venmoHandle}
            onChange={(e) => setVenmoHandle(e.target.value)}
            placeholder="@your-venmo"
            autoCapitalize="none"
            autoCorrect="off"
            inputMode="text"
          />
          <p className="text-[11px] text-muted-foreground">
            We&apos;ll open Venmo so you can confirm the account. Nothing is charged to you.
          </p>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="ghost" onClick={() => setSheetOpen(false)} disabled={requesting}>
              Cancel
            </Button>
            <Button
              onClick={() => void submitPayout()}
              disabled={requesting || !venmoHandle.trim()}
              className="gap-2"
            >
              {requesting && <Loader2 className="h-4 w-4 animate-spin" />}
              Request {formatRealMoney(balance)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
