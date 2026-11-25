import { AlertTriangle, Ban, Clock, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { StrikeResult } from "@/lib/autoBans";

/**
 * The warning popup from the 3-strike ladder.
 *
 * Deliberately hard-coded to black / white / #FE2C55 rather than the theme
 * tokens: a warning has to look the same in light mode, dark mode and on the
 * Android shell, and it has to be unmissable.
 */
export function WarningModal({
  result,
  onClose,
}: {
  result: StrikeResult;
  onClose: () => void;
}) {
  if (!result || !result.strike) return null;

  const strike = Math.min(result.strike, 3);
  const isBan = result.permanent || result.action === "ban" || result.action === "banned";
  const isMute = result.action === "mute";

  const title = isBan
    ? "You are permanently banned"
    : isMute
      ? "You are muted for 24 hours"
      : "This breaks Coolerup rules";

  const body = isBan
    ? "This was your third strike. Your account, this device, and the email or phone number on it are now banned from Coolerup."
    : isMute
      ? "This was your second strike. The post was removed and you cannot post or comment for 24 hours. One more strike is a permanent ban."
      : "This was your first strike. The post was removed. Two more strikes and your account is permanently banned.";

  const until = result.muted_until
    ? new Date(result.muted_until).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : null;

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/85 px-5 backdrop-blur-sm"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="warning-title"
    >
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#FE2C55]/40 bg-black text-white shadow-2xl">
        {/* Strike meter */}
        <div className="flex gap-1.5 px-5 pt-5">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className="h-1.5 flex-1 rounded-full"
              style={{ backgroundColor: n <= strike ? "#FE2C55" : "rgba(255,255,255,0.14)" }}
            />
          ))}
        </div>

        <div className="space-y-4 px-5 pb-5 pt-4">
          <div className="flex items-center gap-3">
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: "rgba(254,44,85,0.16)" }}
            >
              {isBan ? (
                <Ban className="h-5 w-5" style={{ color: "#FE2C55" }} />
              ) : isMute ? (
                <Clock className="h-5 w-5" style={{ color: "#FE2C55" }} />
              ) : (
                <AlertTriangle className="h-5 w-5" style={{ color: "#FE2C55" }} />
              )}
            </span>
            <div className="min-w-0">
              <p
                className="text-[11px] font-bold uppercase tracking-[0.14em]"
                style={{ color: "#FE2C55" }}
              >
                Warning {strike}/3
              </p>
              <h2 id="warning-title" className="text-lg font-bold leading-tight">
                {title}
              </h2>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-white/70">{body}</p>

          {result.message && (
            <p className="rounded-lg bg-white/[0.06] px-3 py-2 text-xs font-medium text-white/80">
              {result.message}
            </p>
          )}

          <ul className="space-y-1.5 text-xs text-white/60">
            {result.deleted && (
              <li className="flex items-center gap-2">
                <Trash2 className="h-3.5 w-3.5 shrink-0" style={{ color: "#FE2C55" }} />
                The post or comment was removed.
              </li>
            )}
            {isMute && (
              <li className="flex items-center gap-2">
                <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: "#FE2C55" }} />
                {until
                  ? `You can post again on ${until}.`
                  : "You cannot post or comment for 24 hours."}
              </li>
            )}
            {isBan && (
              <li className="flex items-center gap-2">
                <Ban className="h-3.5 w-3.5 shrink-0" style={{ color: "#FE2C55" }} />
                You can no longer watch, post, comment or message.
              </li>
            )}
          </ul>

          <Button
            className="w-full font-semibold text-white hover:opacity-90"
            style={{ backgroundColor: "#FE2C55" }}
            onClick={onClose}
          >
            {isBan ? "Close" : "I understand"}
          </Button>
        </div>
      </div>
    </div>
  );
}
