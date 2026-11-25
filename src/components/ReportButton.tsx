import { useState } from "react";
import { Flag, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  REPORT_REASONS,
  reportContent,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/moderation";
import { Button } from "@/components/ui/button";

/**
 * One report button for everything.
 *
 * Drop it on a video, a comment or a profile. It writes to the `reports`
 * table for Admin > Reports and triggers an instant server-side email to
 * moderation.
 */
export function ReportButton({
  username,
  videoId,
  commentId,
  target = "video",
  targetUrl,
  targetText,
  thumbnailUrl,
  getScreenshot,
  className = "",
  label,
  iconClassName = "h-3.5 w-3.5",
}: {
  username: string;
  videoId?: string | null;
  commentId?: string | null;
  target?: ReportTargetType;
  targetUrl?: string | null;
  targetText?: string | null;
  thumbnailUrl?: string | null;
  getScreenshot?: () => string | null;
  className?: string;
  label?: string;
  iconClassName?: string;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const openDialog = async () => {
    if (!auth.user) {
      await auth.signIn();
      return;
    }
    setOpen(true);
  };

  const submit = async () => {
    if (!auth.user) return;
    if (!reason) return;
    setBusy(true);

    const marker =
      target === "comment" && commentId
        ? `[comment:${commentId}] `
        : target === "profile"
          ? "[profile] "
          : "";
    const trimmedDetails = details.trim();
    const resolvedUrl = targetUrl ?? (typeof window !== "undefined" ? window.location.href : null);
    const screenshotDataUrl = getScreenshot ? getScreenshot() : null;

    // Go through reportContent (RPC + instant server email).
    const res = await reportContent(
      videoId ?? null,
      username,
      reason,
      trimmedDetails ? `${marker}${trimmedDetails}`.slice(0, 1000) : marker.trim() || undefined,
      {
        targetType: target,
        commentId: commentId ?? null,
        targetUrl: resolvedUrl,
        targetText: targetText ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        screenshotDataUrl,
        reporterHandle: auth.handle ?? null,
      },
    );

    setBusy(false);
    if (!res.ok) {
      console.error("report failed", res.error);
      toast.error(res.error ?? "Couldn't send report");
      return;
    }
    if (res.duplicate) {
      toast.success("You already reported this — thanks.");
    } else {
      toast.success("Report sent. Thank you for helping keep Coolerup safe.");
    }
    setOpen(false);
    setReason(null);
    setDetails("");
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        aria-label={label ?? "Report"}
        className={
          className ||
          "inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-xs font-medium text-white/50 transition-colors hover:text-[#FE2C55]"
        }
      >
        <Flag className={iconClassName} />
        {label && <span>{label}</span>}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9997] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
          onClick={() => setOpen(false)}
          role="dialog"
          aria-modal="true"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-t-3xl border border-white/15 bg-black p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white sm:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-white">Report @{username}</h2>
                <p className="text-xs text-white/60">
                  {target === "comment"
                    ? "Reporting a comment"
                    : target === "profile"
                      ? "Reporting this profile"
                      : "Reporting this video"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {REPORT_REASONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setReason(item.id)}
                  className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm text-white transition-colors"
                  style={{
                    borderColor: reason === item.id ? "#FE2C55" : "rgba(255,255,255,0.14)",
                    backgroundColor: reason === item.id ? "rgba(254,44,85,0.14)" : "#000000",
                  }}
                >
                  <span>
                    <span className="block font-semibold text-white">{item.label}</span>
                    <span className="block text-xs text-white/60">{item.hint}</span>
                  </span>
                  {reason === item.id && (
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: "#FE2C55" }}
                    />
                  )}
                </button>
              ))}
            </div>

            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Add details (optional)"
              maxLength={1000}
              rows={3}
              className="mt-3 w-full resize-none rounded-lg border border-white/15 bg-black px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-[#FE2C55] focus:outline-none"
            />

            <Button
              className="mt-3 w-full font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: "#FE2C55" }}
              disabled={!reason || busy}
              onClick={() => void submit()}
            >
              {busy ? "Sending…" : "Submit report"}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
