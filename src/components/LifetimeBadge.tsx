/**
 * Gold "lifetime" chrome.
 *
 * Two pieces: a compact pill for lists and profile headers, and a full banner
 * for the Subscription screen. Both read the same grant, so the wording stays
 * identical wherever it appears: who gave it, and that it never expires.
 */
import { Crown } from "lucide-react";
import { lifetimePlanLabel, type LifetimePlan } from "@/lib/subscription";

/** Gold, not amber-on-muted: this is meant to look like the top tier. */
const GOLD = "from-amber-300 via-yellow-400 to-amber-500";
const GOLD_TEXT = "text-amber-900 dark:text-amber-950";

function grantee(grantedBy?: string | null): string {
  const handle = (grantedBy ?? "drewmclawhorn3").replace(/^@/, "");
  return `@${handle}`;
}

/**
 * Small pill: "Lifetime All Access".
 *
 * `plan` narrows the label - "Pro Forever", "VIP Forever" - so a Pro grant is
 * never dressed up as All Access.
 */
export function LifetimeBadge({
  plan = "all",
  className = "",
}: {
  plan?: LifetimePlan | string | null;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-gradient-to-r ${GOLD} px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide ${GOLD_TEXT} shadow-sm ${className}`}
    >
      <Crown className="size-3" aria-hidden="true" />
      {lifetimePlanLabel(plan)}
    </span>
  );
}

/**
 * Full banner for the Subscription screen:
 * "Lifetime All Access - Given by @drewmclawhorn3 - Never Expires".
 */
export function LifetimeBanner({
  plan = "all",
  grantedBy,
  className = "",
}: {
  plan?: LifetimePlan | string | null;
  grantedBy?: string | null;
  className?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border border-amber-400/50 bg-gradient-to-br from-amber-50 via-yellow-50 to-amber-100 p-4 shadow-sm dark:from-amber-500/15 dark:via-yellow-500/10 dark:to-amber-600/15 ${className}`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`grid size-11 shrink-0 place-items-center rounded-full bg-gradient-to-br ${GOLD} ${GOLD_TEXT} shadow`}
        >
          <Crown className="size-6" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-display text-lg font-bold text-amber-900 dark:text-amber-200">
            {lifetimePlanLabel(plan)}
          </p>
          <p className="text-sm text-amber-800/90 dark:text-amber-200/80">
            Given by {grantee(grantedBy)}
          </p>
          <p className="mt-1 inline-flex items-center gap-1 rounded-full bg-amber-900/10 px-2 py-0.5 text-xs font-semibold text-amber-900 dark:bg-amber-200/15 dark:text-amber-200">
            Never expires
          </p>
        </div>
      </div>
    </div>
  );
}
