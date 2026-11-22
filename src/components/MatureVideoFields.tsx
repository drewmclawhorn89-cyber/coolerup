import { Lock } from "lucide-react";

/** Red used for anything 18+. Matches the app's warning accent. */
export const MATURE_RED = "#FE2C55";

/**
 * The "Mark as 18+ — Mature" switch shown while posting a video.
 *
 * Shared by the short-form UploadDialog and the long-form upload page so both
 * flows look and behave the same. It is OFF by default: a video is safe for
 * everyone unless the creator deliberately turns this on. The switch only
 * appears for videos, never for photos.
 */
export function MatureVideoFields({
  enabled,
  onEnabledChange,
}: {
  enabled: boolean;
  onEnabledChange: (next: boolean) => void;
}) {
  return (
    <div
      className="rounded-xl border p-3"
      style={{ backgroundColor: "#000", borderColor: "rgba(255,255,255,0.16)", color: "#fff" }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Lock className="h-4 w-4 shrink-0" style={{ color: MATURE_RED }} />
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: "#fff" }}>
              Mark as 18+ — Mature
            </p>
            <p className="text-xs" style={{ color: "rgba(255,255,255,0.6)" }}>
              {enabled
                ? "Blurred in the feed. Only viewers 18+ can watch."
                : "Off — anyone can watch."}
            </p>
          </div>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label="Mark as 18+ — Mature"
          onClick={() => onEnabledChange(!enabled)}
          className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
          style={{ backgroundColor: enabled ? MATURE_RED : "rgba(255,255,255,0.22)" }}
        >
          <span
            className="absolute top-0.5 h-5 w-5 rounded-full transition-all"
            style={{
              left: enabled ? "1.375rem" : "0.125rem",
              backgroundColor: "#fff",
            }}
          />
        </button>
      </div>
    </div>
  );
}
