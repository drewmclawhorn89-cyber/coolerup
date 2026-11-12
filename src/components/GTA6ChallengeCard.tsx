import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Trophy, X } from "lucide-react";
import { toast } from "sonner";

import {
  claimGTA6Challenge,
  fetchGTA6ChallengeProgress,
  gta6ProgressLabel,
  gta6ProgressPercent,
  gta6Remaining,
  restoreGTA6ChallengeReward,
  GTA6_CHALLENGE_REQUIRED,
  GTA6_CHALLENGE_REWARD_LABEL,
  type GTA6ChallengeProgress,
} from "@/lib/gta6-challenge";
import { GTA6_HASHTAG } from "@/lib/gta6";

/**
 * The "post 10 GTA videos, get 1 month of Pro free" challenge card.
 *
 * Shows live progress from the database, a claim button once the count is met,
 * and a "Pro unlocked until ..." state after claiming. The parent only renders
 * it while the GTA 6 event is live, so it vanishes on Nov 16 2026 along with the
 * rest of the update. A granted plan keeps running to its own end date because
 * it lives in the subscription record, not in this component.
 */
export function GTA6ChallengeCard({
  handle,
  onPost,
  onDismiss,
  refreshKey = 0,
  className = "",
}: {
  /** Signed-in handle, or null when logged out. */
  handle?: string | null;
  onPost: () => void;
  onDismiss?: () => void;
  /** Bump this after a post so the card refetches the count. */
  refreshKey?: number;
  className?: string;
}) {
  const [progress, setProgress] = useState<GTA6ChallengeProgress | null>(null);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);

  const load = useCallback(async () => {
    if (!handle) {
      setProgress(null);
      return;
    }
    setLoading(true);
    const next = await fetchGTA6ChallengeProgress();
    setProgress(next);
    setLoading(false);
  }, [handle]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  // A reward claimed on another device restores itself here.
  useEffect(() => {
    if (!handle) return;
    void restoreGTA6ChallengeReward(handle);
  }, [handle]);

  const posted = progress?.posted ?? 0;
  const required = progress?.required ?? GTA6_CHALLENGE_REQUIRED;
  const claimed = progress?.claimed ?? false;
  const eligible = progress?.eligible ?? posted >= required;
  const percent = gta6ProgressPercent(posted, required);
  const remaining = gta6Remaining(posted, required);

  async function claim() {
    if (!handle) {
      toast.error("Sign in to claim the GTA 6 reward");
      return;
    }
    setClaiming(true);
    const result = await claimGTA6Challenge(handle);
    setClaiming(false);

    if (!result.ok) {
      toast.error(result.message);
      void load();
      return;
    }

    toast.success(`🎉 GTA 6 challenge complete — ${GTA6_CHALLENGE_REWARD_LABEL}!`);
    void load();
  }

  return (
    <div
      className={`gta6-challenge-banner relative mx-3 mb-2 flex shrink-0 flex-col gap-2 rounded-2xl px-3 py-2.5 text-white shadow-lg md:mx-10 ${className}`}
      role="region"
      aria-label="GTA 6 challenge"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-2xl" aria-hidden>
          {claimed ? "🏆" : "🏁"}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold leading-tight">
            {claimed
              ? "GTA 6 Challenge complete!"
              : `${GTA6_HASHTAG} Challenge: post 10 GTA videos`}
          </p>
          <p className="text-[11px] leading-tight text-white/80">
            {claimed
              ? `You unlocked ${GTA6_CHALLENGE_REWARD_LABEL}`
              : `Hit 10 GTA videos and get ${GTA6_CHALLENGE_REWARD_LABEL} · Nov 8 – Nov 15 2026`}
          </p>
        </div>

        {!claimed && (
          <button
            type="button"
            onClick={onPost}
            className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-white/90"
          >
            Post
          </button>
        )}

        {onDismiss && (
          <button
            type="button"
            aria-label="Dismiss GTA 6 challenge"
            onClick={onDismiss}
            className="shrink-0 text-white/70 transition hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {handle ? (
        <div className="flex items-center gap-2">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-black/35"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={required}
            aria-valuenow={Math.min(posted, required)}
            aria-label="GTA 6 challenge progress"
          >
            <div
              className="h-full rounded-full bg-white transition-[width] duration-500"
              style={{ width: `${percent}%` }}
            />
          </div>
          <span className="shrink-0 text-[10px] font-bold tabular-nums text-white/90">
            {claimed ? (
              <span className="inline-flex items-center gap-1">
                <Check className="h-3 w-3" aria-hidden /> Claimed
              </span>
            ) : loading && !progress ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
            ) : (
              gta6ProgressLabel(posted, required)
            )}
          </span>
        </div>
      ) : (
        <p className="text-[10px] text-white/75">
          Sign in and post 10 videos with {GTA6_HASHTAG} to get {GTA6_CHALLENGE_REWARD_LABEL}.
        </p>
      )}

      {handle && eligible && !claimed && (
        <button
          type="button"
          onClick={() => void claim()}
          disabled={claiming}
          className="inline-flex items-center justify-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[11px] font-bold text-black transition hover:bg-white/90 disabled:opacity-70"
        >
          {claiming ? (
            <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          ) : (
            <Trophy className="h-3 w-3" aria-hidden />
          )}
          Claim {GTA6_CHALLENGE_REWARD_LABEL}
        </button>
      )}

      {handle && !claimed && !eligible && (
        <p className="text-[10px] font-medium text-white/75">
          {remaining === 1 ? "1 more GTA video to go" : `${remaining} more GTA videos to go`}
        </p>
      )}
    </div>
  );
}
