import { useEffect, useState } from "react";
import { Lock } from "lucide-react";
import {
  PAID_PRICE_OPTIONS,
  formatPriceCents,
  isValidPaidPriceCents,
  parseCustomPriceCents,
  creatorShareCents,
} from "@/lib/paidVideos";

/** Gold used for anything paid. Matches the product spec exactly. */
export const PAID_GOLD = "#FFC107";

/**
 * The "Make this video Paid" switch plus its price picker.
 *
 * Shared by the short-form UploadDialog and the long-form upload page so both
 * flows look and behave the same. It is OFF by default: a video is free unless
 * the creator deliberately turns this on and picks a price.
 */
export function PaidVideoFields({
  enabled,
  onEnabledChange,
  priceCents,
  onPriceCentsChange,
}: {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  priceCents: number | null;
  onPriceCentsChange: (next: number | null) => void;
}) {
  const presetSelected = PAID_PRICE_OPTIONS.includes(
    (priceCents ?? -1) as (typeof PAID_PRICE_OPTIONS)[number],
  );
  const [customMode, setCustomMode] = useState(!presetSelected && priceCents != null);
  const [customText, setCustomText] = useState(
    !presetSelected && priceCents != null ? (priceCents / 100).toFixed(2) : "",
  );

  // Keep the text box in sync if the parent resets the price.
  useEffect(() => {
    if (customMode) return;
    if (priceCents == null) setCustomText("");
  }, [priceCents, customMode]);

  const customCents = parseCustomPriceCents(customText);
  const customInvalid = customMode && customText.trim().length > 0 && customCents == null;
  const effective = customMode ? customCents : priceCents;
  const valid = !enabled || isValidPaidPriceCents(effective);

  return (
    <div
      className="rounded-xl border p-3"
      style={{ backgroundColor: "#000", borderColor: "rgba(255,255,255,0.16)", color: "#fff" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Lock className="h-4 w-4 shrink-0" style={{ color: PAID_GOLD }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#fff" }}>
              Make this video Paid
            </p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
              {enabled
                ? "Viewers pay once to unlock it forever."
                : "Off — anyone can watch for free."}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Make this video Paid"
          onClick={() => {
            const next = !enabled;
            onEnabledChange(next);
            if (next && priceCents == null) {
              onPriceCentsChange(199);
              setCustomMode(false);
            }
          }}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: enabled ? PAID_GOLD : "rgba(255,255,255,0.22)" }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
            style={{
              left: enabled ? "1.375rem" : "0.125rem",
              backgroundColor: enabled ? "#000" : "#fff",
            }}
          />
        </button>
      </div>

      {enabled && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            {PAID_PRICE_OPTIONS.map((cents) => {
              const active = !customMode && priceCents === cents;
              return (
                <button
                  key={cents}
                  type="button"
                  onClick={() => {
                    setCustomMode(false);
                    onPriceCentsChange(cents);
                  }}
                  className="rounded-full border px-3 py-1.5 text-sm font-bold transition"
                  style={{
                    backgroundColor: active ? PAID_GOLD : "transparent",
                    borderColor: active ? PAID_GOLD : "rgba(255,255,255,0.24)",
                    color: active ? "#000" : "#fff",
                  }}
                >
                  {formatPriceCents(cents)}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setCustomMode(true);
                onPriceCentsChange(customCents);
              }}
              className="rounded-full border px-3 py-1.5 text-sm font-bold transition"
              style={{
                backgroundColor: customMode ? PAID_GOLD : "transparent",
                borderColor: customMode ? PAID_GOLD : "rgba(255,255,255,0.24)",
                color: customMode ? "#000" : "#fff",
              }}
            >
              Custom Price
            </button>
          </div>

          {customMode && (
            <div
              className="flex items-center gap-2 rounded-lg border px-3"
              style={{ borderColor: customInvalid ? "#FE2C55" : "rgba(255,255,255,0.24)" }}
            >
              <span className="text-sm font-semibold" style={{ color: PAID_GOLD }}>
                $
              </span>
              <input
                value={customText}
                onChange={(e) => {
                  const next = e.target.value;
                  setCustomText(next);
                  onPriceCentsChange(parseCustomPriceCents(next));
                }}
                inputMode="decimal"
                placeholder="4.99"
                aria-label="Custom price in dollars"
                className="h-9 w-full bg-transparent text-sm outline-none"
                style={{ color: "#fff" }}
              />
            </div>
          )}

          {customInvalid && (
            <p className="text-xs" style={{ color: "#FE2C55" }}>
              Enter a price between $0.50 and $1,000.
            </p>
          )}

          {valid && effective != null && (
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
              First 10 seconds free, then a lock. You earn{" "}
              <span style={{ color: PAID_GOLD }}>
                {formatPriceCents(creatorShareCents(effective))}
              </span>{" "}
              (80%) of each sale.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** True when the creator has turned paid on but not picked a usable price. */
export function paidSelectionInvalid(enabled: boolean, priceCents: number | null): boolean {
  return enabled && !isValidPaidPriceCents(priceCents);
}
