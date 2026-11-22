import { Music2 } from "lucide-react";
import { Link } from "@tanstack/react-router";

/** TikTok's own brand red, used for the toggle when it is on. */
export const TIKTOK_RED = "#FE2C55";

/**
 * The "Also post to TikTok" switch shown while posting a video.
 *
 * OFF by default, and only rendered when the creator has actually linked their
 * TikTok account — offering the switch to an unlinked user would just fail after
 * the upload. When the account is missing, a short prompt points at Settings.
 */
export function TikTokPostFields({
  enabled,
  onEnabledChange,
  linkedUsername,
  checking,
}: {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
  linkedUsername: string | null;
  checking: boolean;
}) {
  const shell = {
    backgroundColor: "#000",
    borderColor: "rgba(255,255,255,0.16)",
    color: "#fff",
  } as const;

  if (checking) {
    return (
      <div className="rounded-xl border p-3" style={shell}>
        <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
          Checking your TikTok connection…
        </p>
      </div>
    );
  }

  if (!linkedUsername) {
    return (
      <div className="rounded-xl border p-3" style={shell}>
        <div className="flex items-center gap-2">
          <Music2 className="h-4 w-4 shrink-0" style={{ color: TIKTOK_RED }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#fff" }}>
              Also post to TikTok
            </p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
              <Link to="/settings" className="underline">
                Link your TikTok account
              </Link>{" "}
              to cross-post while you upload.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-3" style={shell}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Music2 className="h-4 w-4 shrink-0" style={{ color: TIKTOK_RED }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#fff" }}>
              Also post to TikTok
            </p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
              {enabled
                ? `Posts to @${linkedUsername} with "Posted from Coolerup" in the caption.`
                : `Off \u2014 stays on Coolerup only.`}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Also post to TikTok"
          onClick={() => onEnabledChange(!enabled)}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: enabled ? TIKTOK_RED : "rgba(255,255,255,0.22)" }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
            style={{ left: enabled ? "1.375rem" : "0.125rem", backgroundColor: "#fff" }}
          />
        </button>
      </div>
    </div>
  );
}
