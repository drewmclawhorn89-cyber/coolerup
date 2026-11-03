/**
 * "You got your first follower" celebration.
 *
 * Shown exactly once per account: the database marks the reward `notified` the
 * first time the app claims it, so refreshing, switching tabs, or a second
 * device can't replay the confetti.
 *
 * The confetti is plain CSS (no dependency) and honours
 * `prefers-reduced-motion`, because a full-screen particle burst is exactly the
 * kind of thing that should respect that setting.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PartyPopper, Wallet } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { confettiPieces } from "@/lib/confetti";
import {
  FOLLOWER_REWARD_AMOUNT,
  formatRealMoney,
  notifyRealBalanceChanged,
  takeFollowerRewardNotice,
  type FollowerRewardNotice,
} from "@/lib/follow";

export function Confetti({ count = 60 }: { count?: number }) {
  const pieces = useMemo(() => confettiPieces(count), [count]);
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden">
      <style>{`
        @keyframes cu-confetti-fall {
          0% { transform: translate3d(0, -12vh, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate3d(var(--cu-drift), 108vh, 0) rotate(720deg); opacity: 0.9; }
        }
        @media (prefers-reduced-motion: reduce) {
          .cu-confetti-piece { animation: none !important; display: none; }
        }
      `}</style>
      {pieces.map((p, i) => (
        <span
          key={i}
          className="cu-confetti-piece absolute top-0 block rounded-[2px]"
          style={{
            left: `${p.left}%`,
            width: `${p.size}px`,
            height: `${p.size * 1.6}px`,
            backgroundColor: p.color,
            transform: `rotate(${p.rotate}deg)`,
            animation: `cu-confetti-fall ${p.duration}s linear ${p.delay}s forwards`,
            ["--cu-drift" as string]: `${p.drift}px`,
          }}
        />
      ))}
    </div>
  );
}

export type FollowerRewardModalProps = {
  open: boolean;
  amount?: number;
  username?: string | null;
  onClose: () => void;
};

export function FollowerRewardModal({
  open,
  amount = FOLLOWER_REWARD_AMOUNT,
  username,
  onClose,
}: FollowerRewardModalProps) {
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    if (!open) {
      setBurst(false);
      return;
    }
    setBurst(true);
    // Stop the particles after the longest fall so they don't sit in the DOM.
    const t = window.setTimeout(() => setBurst(false), 6000);
    return () => window.clearTimeout(t);
  }, [open]);

  return (
    <>
      {burst && <Confetti />}
      <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
        <DialogContent className="max-w-sm overflow-hidden rounded-3xl border-border bg-card text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-[#25f4ee]/15">
            <PartyPopper className="h-8 w-8 text-[#25f4ee]" />
          </div>
          <DialogTitle className="text-xl font-extrabold">
            🎉 You got your first follower!
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {username ? `@${username} is` : "Someone is"} now following you. That unlocked your
            creator-fund reward.
          </DialogDescription>

          <div className="rounded-2xl border border-[#25f4ee]/30 bg-[#25f4ee]/10 px-4 py-5">
            <p className="text-3xl font-black tracking-tight text-foreground">
              {formatRealMoney(amount)}
            </p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              real money added to your wallet
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            This is cash, not coins — cash out any time from $1.00.
          </p>

          <div className="flex flex-col gap-2">
            <Button asChild className="gap-2">
              <Link to="/wallet" onClick={onClose}>
                <Wallet className="h-4 w-4" />
                Go to Wallet to cash out
              </Link>
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Maybe later
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * App-wide listener for the first-follower payout.
 *
 * Mounted once in the root layout. It claims the one-time notice on mount, on
 * focus, and on a realtime insert, so the celebration lands within a second of
 * the follow even if the user is already sitting in the feed.
 */
export function FollowerRewardWatcher() {
  const auth = useAuth();
  const userId = auth.user?.id ?? null;
  const [notice, setNotice] = useState<FollowerRewardNotice | null>(null);

  const claim = useCallback(async () => {
    if (!userId) return;
    const next = await takeFollowerRewardNotice();
    if (!next) return;
    setNotice(next);
    notifyRealBalanceChanged();
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    void claim();
    const onFocus = () => void claim();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [userId, claim]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`follower-reward:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "follower_rewards",
          filter: `user_id=eq.${userId}`,
        },
        () => void claim(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, claim]);

  if (!notice) return null;

  return (
    <FollowerRewardModal
      open
      amount={notice.rewardAmount}
      username={notice.username}
      onClose={() => setNotice(null)}
    />
  );
}
