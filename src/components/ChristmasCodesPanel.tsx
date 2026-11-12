/**
 * The "Codes" top tab, shown only during the Christmas Update.
 *
 * Seasonal by design: `useChristmasCodesSeason()` returns false outside
 * Nov 15 - Jan 1, and the tab disappears from the top bar entirely. Nothing is
 * persisted, so it comes back on its own next Christmas.
 *
 * The list here is marketing copy. Every redemption goes through the same
 * `redeem_subscription_code` RPC as /paywall and /redeem, so limits, expiry and
 * single-use enforcement all stay in the database.
 */
import { useEffect, useState } from "react";
import { Check, Copy, Gift, Snowflake, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { RedeemCodeBox } from "@/components/RedeemCodeBox";
import { codeSubscriptionSummary, myCodeSubscriptions, type CodeSubscription } from "@/lib/codes";
import {
  CHRISTMAS_CODE_HIGHLIGHTS,
  christmasCodesSeasonLabel,
  daysLeftInSeason,
  type ChristmasCodeHighlight,
} from "@/lib/christmas-codes";

const PLAN_STYLES: Record<ChristmasCodeHighlight["plan"], string> = {
  basic: "from-sky-500/20 to-sky-500/5 border-sky-400/30 text-sky-200",
  premium: "from-amber-500/20 to-amber-500/5 border-amber-400/30 text-amber-200",
};

function monthsText(months: number): string {
  if (months === 1) return "1 month";
  if (months === 12) return "12 months";
  return `${months} months`;
}

function CodeCard({ item }: { item: ChristmasCodeHighlight }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.code);
      setCopied(true);
      toast.success(`${item.code} copied`);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error("Couldn't copy — type the code instead");
    }
  };

  return (
    <div className={`rounded-2xl border bg-gradient-to-br p-4 ${PLAN_STYLES[item.plan]}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-sm font-bold text-white">
            <span aria-hidden className="text-base leading-none">
              {item.emoji}
            </span>
            {item.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-white/70">{item.blurb}</p>
        </div>
        <span className="shrink-0 rounded-full border border-white/20 bg-black/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white/80">
          {item.plan === "premium" ? "Premium" : "Basic"}
        </span>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-white/15 bg-black/40 px-3 py-2 font-mono text-sm font-bold tracking-wider text-white">
          {item.code}
        </code>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => void copy()}
          className="shrink-0 gap-1.5"
          aria-label={`Copy ${item.code}`}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>

      <p className="mt-2 text-[11px] text-white/50">
        {monthsText(item.months)} · {item.note}
      </p>
    </div>
  );
}

export function ChristmasCodesPanel({
  handle,
  onSignIn,
  className = "",
}: {
  handle?: string | null | undefined;
  onSignIn?: (() => void) | undefined;
  className?: string;
}) {
  const [subs, setSubs] = useState<CodeSubscription[] | null>(null);

  // Pull any code grants already on this account so the tab can show what's
  // active rather than just what's on offer.
  useEffect(() => {
    if (!handle) {
      setSubs([]);
      return;
    }
    let cancelled = false;
    void myCodeSubscriptions().then((rows) => {
      if (!cancelled) setSubs(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [handle]);

  const active = subs?.[0] ?? null;
  const activeSummary = active
    ? codeSubscriptionSummary({
        planId: active.plan === "premium" ? "vip" : "plus",
        status: "active",
        startedAt: active.redeemed_at,
        paidAt: active.redeemed_at,
        paymentMethod: null,
        source: "code",
        code: active.code,
        currentPeriodEnd: active.ends_at,
      })
    : null;

  const daysLeft = daysLeftInSeason();

  return (
    <div className={`no-scrollbar min-h-0 flex-1 overflow-y-auto ${className}`}>
      <div className="mx-auto w-full max-w-2xl px-4 pb-24 pt-[calc(env(safe-area-inset-top)+5.5rem)]">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-red-600/25 via-emerald-600/15 to-transparent p-5">
          <Snowflake
            aria-hidden
            className="pointer-events-none absolute -right-4 -top-4 size-24 text-white/5"
          />
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-300">
            {christmasCodesSeasonLabel()} · Limited time
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold text-white">Christmas codes 🎄</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-white/70">
            Free months of Coolerup, wrapped up for the holidays. Tap a code to copy it, then redeem
            below — or enter any code you were sent.
          </p>
          {daysLeft > 0 && (
            <p className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3 py-1 text-xs font-semibold text-white/80">
              <Sparkles className="size-3.5" />
              {daysLeft === 1 ? "Last day" : `${daysLeft} days left`} in this season
            </p>
          )}
        </div>

        {/* Already active */}
        {activeSummary && (
          <div className="mt-3 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm font-semibold text-emerald-200">
            {activeSummary}
          </div>
        )}

        {/* Redeem */}
        <div className="mt-4">
          <RedeemCodeBox handle={handle} onSignIn={onSignIn} />
        </div>

        {/* Code list */}
        <div className="mt-6">
          <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-white/60">
            <Gift className="size-4" />
            This season's codes
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {CHRISTMAS_CODE_HIGHLIGHTS.map((item) => (
              <CodeCard key={item.code} item={item} />
            ))}
          </div>
        </div>

        <p className="mt-6 text-center text-[11px] leading-relaxed text-white/40">
          One redemption per account per code. Codes expire when the season ends, and this tab
          disappears on Jan 2 — then comes back next Christmas.
        </p>
      </div>
    </div>
  );
}
