import { useState } from "react";
import { Coins, CreditCard, Loader2, Lock, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useCoins } from "@/lib/coins";
import {
  FREE_PREVIEW_SECONDS,
  coinsForPriceCents,
  formatPriceCents,
  purchasePaidVideoWithCoins,
  rememberOwned,
  notifyPaidVideoChanged,
  useVideoOwnership,
  type PaidVideoKind,
} from "@/lib/paidVideos";
import { requestGooglePay } from "@/lib/googlepay";
import { chargeVideoWithGooglePay } from "@/lib/payments.functions";

const GOLD = "#FFC107";
const RED = "#FE2C55";

/**
 * The lock that sits on a paid video.
 *
 * Renders nothing once the viewer owns the video, so callers can drop it on top
 * of any player unconditionally. Tapping "Pay to Watch" opens the purchase
 * sheet, which offers Coolerup Coins or a card; either way the unlock is
 * permanent and the database refuses to charge twice.
 */
export function PaidVideoGate({
  videoId,
  kind,
  priceCents,
  thumbnailUrl,
  title,
  onUnlocked,
  variant = "fill",
  className = "",
}: {
  videoId: string;
  kind: PaidVideoKind;
  priceCents: number;
  thumbnailUrl?: string | null | undefined;
  title?: string | undefined;
  onUnlocked?: (() => void) | undefined;
  variant?: "fill" | "compact" | undefined;
  className?: string | undefined;
}) {
  const owned = useVideoOwnership(videoId, kind, true);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (owned) return null;

  return (
    <>
      <div
        className={`absolute inset-0 z-20 flex flex-col items-center justify-center overflow-hidden text-center ${className}`}
        style={{ backgroundColor: "rgba(0,0,0,0.72)" }}
      >
        {thumbnailUrl && (
          <img
            src={thumbnailUrl}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-110 object-cover opacity-40 blur-xl"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(circle at 50% 40%, rgba(0,0,0,0.35), rgba(0,0,0,0.85) 75%)",
          }}
        />

        <div
          className={`relative flex flex-col items-center gap-2 px-4 ${variant === "compact" ? "scale-90" : ""}`}
        >
          <span
            className="flex items-center justify-center rounded-full"
            style={{
              width: variant === "compact" ? 36 : 52,
              height: variant === "compact" ? 36 : 52,
              backgroundColor: "rgba(255,193,7,0.14)",
              border: `1px solid ${GOLD}`,
            }}
          >
            <Lock
              style={{ color: GOLD }}
              className={variant === "compact" ? "h-4 w-4" : "h-6 w-6"}
            />
          </span>

          <p
            className={`font-bold ${variant === "compact" ? "text-xs" : "text-sm"}`}
            style={{ color: "#fff" }}
          >
            {formatPriceCents(priceCents)}
          </p>

          {variant !== "compact" && (
            <p className="max-w-[16rem] text-xs" style={{ color: "rgba(255,255,255,0.7)" }}>
              {title ? title : `Watch the first ${FREE_PREVIEW_SECONDS} seconds free`}
            </p>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              e.preventDefault();
              setSheetOpen(true);
            }}
            className={`mt-1 rounded-full font-bold text-white transition active:scale-95 ${
              variant === "compact" ? "px-3 py-1 text-xs" : "px-5 py-2 text-sm"
            }`}
            style={{ backgroundColor: RED }}
          >
            Pay to Watch
          </button>
        </div>
      </div>

      {sheetOpen && (
        <PurchaseSheet
          videoId={videoId}
          kind={kind}
          priceCents={priceCents}
          title={title}
          onClose={() => setSheetOpen(false)}
          onUnlocked={() => {
            setSheetOpen(false);
            onUnlocked?.();
          }}
        />
      )}
    </>
  );
}

function PurchaseSheet({
  videoId,
  kind,
  priceCents,
  title,
  onClose,
  onUnlocked,
}: {
  videoId: string;
  kind: PaidVideoKind;
  priceCents: number;
  title?: string | undefined;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const auth = useAuth();
  const wallet = useCoins(auth.user?.id);
  const [busy, setBusy] = useState<"coins" | "card" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const coinCost = coinsForPriceCents(priceCents);
  const balance = wallet.balance ?? 0;
  const canAfford = wallet.balance != null && balance >= coinCost;

  const finish = () => {
    rememberOwned(kind, videoId);
    notifyPaidVideoChanged();
    toast.success("Unlocked — this video is yours forever.");
    onUnlocked();
  };

  const payWithCoins = async () => {
    if (!auth.user) {
      setError("Sign in to buy this video.");
      return;
    }
    setBusy("coins");
    setError(null);
    const result = await purchasePaidVideoWithCoins(videoId, kind);
    setBusy(null);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    void wallet.refresh();
    finish();
  };

  const payWithCard = async () => {
    if (!auth.user) {
      setError("Sign in to buy this video.");
      return;
    }
    setBusy("card");
    setError(null);
    try {
      const pay = await requestGooglePay(priceCents / 100, `Paid video · Coolerup`);
      if (!pay.ok) {
        if (pay.reason === "cancelled") {
          setBusy(null);
          return;
        }
        setError(
          pay.reason === "unavailable"
            ? "Card payments couldn't load here. Pay with Coolerup Coins instead."
            : (pay.message ?? "Card payment didn't go through."),
        );
        setBusy(null);
        return;
      }

      const charge = await chargeVideoWithGooglePay({
        data: { videoId, kind, paymentToken: pay.token },
      });
      setBusy(null);
      if (!charge.ok) {
        setError(charge.message);
        return;
      }
      finish();
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : "Card payment failed.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center p-3 sm:items-center"
      style={{ backgroundColor: "rgba(0,0,0,0.75)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Pay to watch"
        className="w-full max-w-sm rounded-2xl border p-5"
        style={{ backgroundColor: "#000", borderColor: "rgba(255,255,255,0.16)", color: "#fff" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: GOLD }}>
              Paid video
            </p>
            <h2 className="mt-1 truncate text-lg font-bold" style={{ color: "#fff" }}>
              {title || "Unlock this video"}
            </h2>
            <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.65)" }}>
              Pay once, watch forever. The creator keeps 80%.
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" style={{ color: "rgba(255,255,255,0.7)" }} />
          </button>
        </div>

        <div
          className="mt-4 flex items-center justify-between rounded-xl border px-4 py-3"
          style={{ borderColor: "rgba(255,193,7,0.4)", backgroundColor: "rgba(255,193,7,0.08)" }}
        >
          <span className="text-sm" style={{ color: "rgba(255,255,255,0.8)" }}>
            Price
          </span>
          <span className="text-xl font-bold" style={{ color: GOLD }}>
            {formatPriceCents(priceCents)}
          </span>
        </div>

        <div className="mt-4 space-y-2">
          <button
            type="button"
            disabled={busy != null || !canAfford}
            onClick={() => void payWithCoins()}
            className="flex w-full items-center justify-between rounded-full px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
            style={{ backgroundColor: RED }}
          >
            <span className="flex items-center gap-2">
              <Coins className="h-4 w-4" />
              Pay with Coins
            </span>
            <span className="tabular-nums">
              {busy === "coins" ? "…" : `${coinCost.toLocaleString()} coins`}
            </span>
          </button>

          <button
            type="button"
            disabled={busy != null}
            onClick={() => void payWithCard()}
            className="flex w-full items-center justify-between rounded-full border px-4 py-3 text-sm font-bold disabled:opacity-50"
            style={{ borderColor: "rgba(255,255,255,0.24)", color: "#fff" }}
          >
            <span className="flex items-center gap-2">
              {busy === "card" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <CreditCard className="h-4 w-4" />
              )}
              Pay with Card
            </span>
            <span className="tabular-nums">{formatPriceCents(priceCents)}</span>
          </button>
        </div>

        <p className="mt-3 text-center text-xs" style={{ color: "rgba(255,255,255,0.55)" }}>
          {wallet.balance == null
            ? "Loading your wallet…"
            : canAfford
              ? `Balance: ${balance.toLocaleString()} coins`
              : `You have ${balance.toLocaleString()} coins — need ${coinCost.toLocaleString()}`}
        </p>

        {error && (
          <p className="mt-2 text-center text-xs" style={{ color: RED }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
