import { useCallback, useEffect, useRef, useState } from "react";
import { Coins, Loader2, Timer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  FREE_COINS_AMOUNT,
  claimFreeCoins,
  formatCountdown,
  isMobileDevice,
  msUntil,
  myFreeCoinClaim,
  notifyCoinsChanged,
  useCoins,
  venmoFreeCoinsAppUrl,
  venmoFreeCoinsWebUrl,
  type FreeCoinClaimState,
} from "@/lib/coins";

/** Venmo's brand blue. */
const VENMO_BLUE = "#3D95CE";

type Phase = "idle" | "checking" | "claiming";

/**
 * "Get 10 free coins via Venmo" button.
 *
 * Flow: tap -> open Venmo (deep link on phones, web otherwise) -> we ask
 * "Did you open Venmo?" -> Confirm credits the coins server-side. The server
 * enforces one claim per user per day, so the button turns into a countdown
 * once today's claim is used.
 */
export function VenmoFreeCoins() {
  const { user, signIn } = useAuth();
  const wallet = useCoins(user?.id);
  const [claim, setClaim] = useState<FreeCoinClaimState>({ claimed: false });
  const [phase, setPhase] = useState<Phase>("idle");
  const [asking, setAsking] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fallbackTimer = useRef<number | null>(null);

  const refreshState = useCallback(async () => {
    if (!user?.id) {
      setClaim({ claimed: false });
      return;
    }
    setPhase("checking");
    try {
      const next = await myFreeCoinClaim();
      setClaim(next);
    } finally {
      setPhase("idle");
    }
  }, [user?.id]);

  useEffect(() => {
    void refreshState();
  }, [refreshState]);

  const remaining = claim.claimed ? msUntil(claim.nextClaimAt, now) : 0;
  const locked = claim.claimed && remaining > 0;

  // Tick the countdown once a second while a claim is on cooldown.
  useEffect(() => {
    if (!locked) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [locked]);

  // If the countdown runs out, re-check so the button unlocks without a reload.
  useEffect(() => {
    if (claim.claimed && remaining === 0 && claim.nextClaimAt) void refreshState();
  }, [claim.claimed, claim.nextClaimAt, remaining, refreshState]);

  useEffect(() => {
    return () => {
      if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
    };
  }, []);

  const openVenmo = useCallback(() => {
    if (!user) {
      signIn();
      return;
    }
    if (locked) {
      toast(`Next free coins in ${formatCountdown(remaining)}`);
      return;
    }

    const web = venmoFreeCoinsWebUrl();

    if (isMobileDevice()) {
      // Try the app first; if nothing handles venmo:// the page just stays put,
      // so fall back to the web link after a moment.
      if (fallbackTimer.current) window.clearTimeout(fallbackTimer.current);
      fallbackTimer.current = window.setTimeout(() => {
        window.open(web, "_blank", "noopener,noreferrer");
      }, 1200);
      window.location.href = venmoFreeCoinsAppUrl();
    } else {
      window.open(web, "_blank", "noopener,noreferrer");
    }

    setAsking(true);
  }, [locked, remaining, signIn, user]);

  const confirmClaim = useCallback(async () => {
    if (phase === "claiming") return;
    setPhase("claiming");
    try {
      const result = await claimFreeCoins();
      if (!result.ok) {
        if (result.alreadyClaimed) {
          toast(result.message || "You already grabbed today's free coins");
          setAsking(false);
          await refreshState();
          return;
        }
        toast.error(result.message);
        return;
      }

      toast.success(`+${result.coins} coins! 🪙`);
      wallet.setBalance(result.balance);
      notifyCoinsChanged();
      setClaim({
        claimed: true,
        claimedAt: new Date().toISOString(),
        coins: result.coins,
        ...(result.nextClaimAt ? { nextClaimAt: result.nextClaimAt } : {}),
      });
      setNow(Date.now());
      setAsking(false);
    } finally {
      setPhase("idle");
    }
  }, [phase, refreshState, wallet]);

  const label = locked
    ? `Next free coins in ${formatCountdown(remaining)}`
    : phase === "checking"
      ? "Checking…"
      : `Get ${FREE_COINS_AMOUNT} Free Coins via Venmo 🪙`;

  return (
    <>
      <button
        type="button"
        onClick={openVenmo}
        disabled={locked || phase === "checking"}
        className="flex w-full items-center justify-center gap-2 rounded-2xl px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-black/30 transition active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
        style={{ backgroundColor: VENMO_BLUE }}
      >
        {locked ? (
          <Timer className="h-4 w-4" />
        ) : phase === "checking" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Coins className="h-4 w-4" />
        )}
        <span className="tabular-nums">{label}</span>
      </button>

      <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
        One free drop per day. Opens Venmo — no charge, just a quick hello.
      </p>

      <Dialog open={asking} onOpenChange={setAsking}>
        <DialogContent className="max-w-sm border-white/10 bg-[#12121a] text-white">
          <DialogHeader>
            <DialogTitle className="text-lg">Did you open Venmo?</DialogTitle>
            <DialogDescription className="text-white/60">
              Tap Confirm to get {FREE_COINS_AMOUNT} coins. We'll drop them straight into your
              wallet.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => setAsking(false)}
              disabled={phase === "claiming"}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="flex-1 text-white"
              style={{ backgroundColor: VENMO_BLUE }}
              onClick={() => void confirmClaim()}
              disabled={phase === "claiming"}
            >
              {phase === "claiming" ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Adding…
                </>
              ) : (
                `Confirm +${FREE_COINS_AMOUNT}`
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
