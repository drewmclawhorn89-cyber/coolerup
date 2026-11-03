import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
  CheckCircle2,
  Eye,
  Gem,
  Loader2,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { WalletBalance } from "@/components/WalletBalance";
import { useAuth } from "@/hooks/useAuth";
import {
  CREATOR_FUND_MILESTONES,
  QUALIFY_FOLLOWERS,
  QUALIFY_VIEWS_30D,
  checkCreatorFund,
  formatViews,
  milestoneProgress,
  useCreatorFund,
} from "@/lib/creatorFund";
import { formatUsd, notifyWalletChanged } from "@/lib/payouts";

export const Route = createFileRoute("/creator")({
  head: () => ({
    meta: [
      { title: "Creator dashboard — Coolerup" },
      {
        name: "description",
        content:
          "Track your views, followers and creator-fund earnings, and see how close you are to the next milestone.",
      },
      { property: "og:title", content: "Creator dashboard — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CreatorPage,
});

function CreatorPage() {
  const auth = useAuth();
  const fund = useCreatorFund(auth.user?.id);
  const [checking, setChecking] = useState(false);

  const runCheck = useCallback(
    async (announce: boolean) => {
      if (!auth.user) return;
      setChecking(true);
      const before = fund.earned;
      const next = await checkCreatorFund(auth.user.id);
      setChecking(false);
      await fund.refresh();
      if (!announce) return;
      if (next.earned > before) {
        toast.success(`Creator fund paid ${formatUsd(next.earned - before)} 🎉`);
        notifyWalletChanged();
      } else {
        toast.message("No new milestones yet", {
          description: next.qualified
            ? "Keep posting — milestones pay as your views grow."
            : `You need ${QUALIFY_FOLLOWERS} followers and ${formatViews(QUALIFY_VIEWS_30D)} views in 30 days.`,
        });
      }
    },
    [auth.user, fund],
  );

  // Run the milestone check once on load: it is idempotent, so this is how a
  // creator gets paid without anyone pressing a button.
  useEffect(() => {
    if (!auth.user) return;
    void runCheck(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.user?.id]);

  const progress = milestoneProgress(fund.totalViews);
  const next = fund.nextMilestone;
  const remaining = next === null ? 0 : Math.max(0, next - fund.totalViews);

  return (
    <div className="mx-auto min-h-screen w-full max-w-2xl bg-black px-4 pb-24 pt-4 text-white">
      <header className="mb-4 flex items-center gap-2">
        <Link
          to="/wallet"
          className="rounded-full p-2 hover:bg-white/10"
          aria-label="Back to wallet"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-semibold">Creator dashboard</h1>
          <p className="text-xs text-white/50">Views, followers and creator-fund earnings</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void runCheck(true)}
          disabled={checking || !auth.user}
          className="gap-1.5 border-white/15 text-white/80"
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Check
        </Button>
      </header>

      <WalletBalance />

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <BadgeCheck
              className={fund.qualified ? "h-4 w-4 text-emerald-400" : "h-4 w-4 text-white/40"}
              aria-hidden="true"
            />
            Creator fund
          </h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
              fund.qualified ? "bg-emerald-500/15 text-emerald-300" : "bg-white/10 text-white/60"
            }`}
          >
            {fund.qualified ? "Qualified" : "Not qualified yet"}
          </span>
        </div>

        <p className="mt-2 text-sm text-white/60">
          {fund.qualified
            ? "Every milestone below pays automatically as your lifetime views grow."
            : `Reach ${QUALIFY_FOLLOWERS} followers and ${formatViews(QUALIFY_VIEWS_30D)} views in the last 30 days to start earning.`}
        </p>

        <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Metric
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Total views"
            value={formatViews(fund.totalViews)}
          />
          <Metric
            icon={<Eye className="h-3.5 w-3.5" />}
            label="Last 30 days"
            value={formatViews(fund.views30d)}
            highlight={fund.views30d >= QUALIFY_VIEWS_30D}
          />
          <Metric
            icon={<Users className="h-3.5 w-3.5" />}
            label="Followers"
            value={formatViews(fund.followers)}
            highlight={fund.followers >= QUALIFY_FOLLOWERS}
          />
        </dl>

        <div className="mt-4">
          <div className="flex items-center justify-between text-xs text-white/50">
            <span>
              {next === null
                ? "All milestones reached"
                : `${formatViews(remaining)} views to ${formatViews(next)}`}
            </span>
            <span className="tabular-nums">{Math.round(progress * 100)}%</span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#fe2c55] to-[#25f4ee] transition-all"
              style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }}
            />
          </div>
        </div>

        <ul className="mt-4 space-y-1.5">
          {CREATOR_FUND_MILESTONES.map((m) => {
            const paid = fund.earnings.some((e) => e.milestoneViews === m.views);
            const reached = fund.totalViews >= m.views;
            return (
              <li
                key={m.views}
                className="flex items-center justify-between rounded-lg bg-black/25 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2 text-white/70">
                  {paid ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden="true" />
                  ) : (
                    <Gem className="h-4 w-4 text-white/25" aria-hidden="true" />
                  )}
                  {formatViews(m.views)} views
                </span>
                <span
                  className={
                    paid
                      ? "font-semibold text-emerald-300"
                      : reached
                        ? "font-medium text-white"
                        : "text-white/40"
                  }
                >
                  {paid ? "Paid" : formatUsd(m.amount)}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-white/60" aria-hidden="true" /> Fund earnings
          </h2>
          <p className="text-sm font-semibold tabular-nums text-emerald-300">
            {formatUsd(fund.earned)}
          </p>
        </div>
        {fund.earnings.length === 0 ? (
          <p className="mt-3 text-sm text-white/50">
            No creator-fund earnings yet. Views only count once per signed-in viewer, and your own
            views never count.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {fund.earnings.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium">{formatViews(e.milestoneViews)} views</p>
                  <p className="text-xs text-white/45">
                    {new Date(e.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-sm font-semibold tabular-nums text-emerald-300">
                  +{formatUsd(e.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Link
          to="/wallet"
          className="flex items-center justify-center gap-2 rounded-xl border border-white/15 px-4 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
        >
          Open wallet <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <Link
          to="/coins/recharge"
          className="flex items-center justify-center gap-2 rounded-xl bg-[#fe2c55] px-4 py-3 text-sm font-semibold text-white hover:bg-[#e0264c]"
        >
          Buy coins
        </Link>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  highlight = false,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div className="rounded-lg bg-black/30 py-2">
      <dt className="flex items-center justify-center gap-1 text-[10px] uppercase tracking-wide text-white/40">
        {icon}
        {label}
      </dt>
      <dd
        className={`text-sm font-semibold tabular-nums ${highlight ? "text-emerald-300" : "text-white"}`}
      >
        {value}
      </dd>
    </div>
  );
}
