/**
 * "Have a code? Enter code" — the Netflix-style redemption box.
 *
 * Reused in three places so the behaviour is identical everywhere:
 *   - /paywall, under the plan list
 *   - /redeem, the standalone gift-card page
 *   - Settings -> Subscriptions ("Redeem Code")
 */
import { useId, useState } from "react";
import { CheckCircle2, Gift, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Confetti } from "@/components/FollowerRewardModal";
import { formatCodeEnd, monthsLabel, redeemCode, type RedeemResult } from "@/lib/codes";

export function RedeemCodeBox({
  handle,
  onSignIn,
  onRedeemed,
  className = "",
  autoFocus = false,
}: {
  handle?: string | null | undefined;
  onSignIn?: (() => void) | undefined;
  onRedeemed?: ((result: Extract<RedeemResult, { ok: true }>) => void) | undefined;
  className?: string;
  autoFocus?: boolean;
}) {
  const inputId = useId();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RedeemResult | null>(null);
  const [burst, setBurst] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!handle) {
      onSignIn?.();
      if (!onSignIn) toast.error("Sign in to redeem a code");
      return;
    }
    if (!code.trim()) {
      toast.error("Enter a code");
      return;
    }

    setBusy(true);
    setResult(null);
    try {
      const res = await redeemCode(code, handle);
      setResult(res);
      if (res.ok) {
        setCode("");
        setBurst(true);
        toast.success(`Success! You got ${monthsLabel(res.months)} ${res.planLabel}! 🎉`);
        onRedeemed?.(res);
        window.setTimeout(() => setBurst(false), 6500);
      } else {
        toast.error(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-background to-background p-4 ${className}`}
    >
      {burst && <Confetti count={80} />}

      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Gift className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold">Have a code?</h3>
          <p className="text-xs text-muted-foreground">
            Enter your gift card or promo code to unlock a plan.
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="mt-3 flex gap-2">
        <label htmlFor={inputId} className="sr-only">
          Subscription code
        </label>
        <Input
          id={inputId}
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="Enter code"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          autoFocus={autoFocus}
          className="h-11 flex-1 font-mono tracking-wider"
          disabled={busy}
        />
        <Button type="submit" className="h-11 px-5" disabled={busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Redeem"}
        </Button>
      </form>

      {result && !result.ok && (
        <p role="alert" className="mt-2 text-sm font-medium text-destructive">
          {result.message}
        </p>
      )}

      {result?.ok && (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
          <div>
            <p className="font-semibold text-emerald-700 dark:text-emerald-400">
              Success! You got {monthsLabel(result.months)} {result.planLabel}! 🎉
            </p>
            <p className="text-xs text-muted-foreground">
              Code {result.code} is active until {formatCodeEnd(result.endsAt)}.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
