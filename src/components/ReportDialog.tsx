import { useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import {
  REPORT_REASONS,
  reportContent,
  type ReportReason,
  type ReportTargetType,
} from "@/lib/moderation";
import { Button } from "@/components/ui/button";

export function ReportDialog({
  username,
  videoId,
  commentId,
  target = "video",
  targetUrl,
  targetText,
  thumbnailUrl,
  onClose,
}: {
  username: string;
  videoId?: string;
  commentId?: string;
  target?: ReportTargetType;
  targetUrl?: string | null;
  targetText?: string | null;
  thumbnailUrl?: string | null;
  onClose: () => void;
}) {
  const auth = useAuth();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!auth.user) return auth.signIn();
    if (!reason) return;
    setBusy(true);
    const res = await reportContent(
      videoId ?? null,
      username,
      reason,
      details.trim().slice(0, 1000) || undefined,
      {
        targetType: target,
        commentId: commentId ?? null,
        targetUrl: targetUrl ?? (typeof window !== "undefined" ? window.location.href : null),
        targetText: targetText ?? null,
        thumbnailUrl: thumbnailUrl ?? null,
        reporterHandle: auth.handle ?? null,
      },
    );
    setBusy(false);
    if (!res.ok) return toast.error(res.error ?? "Couldn't send report");
    toast.success("Report sent. Thank you for keeping Coolerup safe.");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl border border-white/15 bg-black p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white sm:rounded-3xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-lg text-white">Report @{username}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-1 text-white/60 hover:bg-white/10 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {!auth.user ? (
          <Button onClick={auth.signIn} className="w-full rounded-full bg-[#FE2C55] text-white">
            Sign in to report
          </Button>
        ) : (
          <>
            <div className="space-y-1.5">
              {REPORT_REASONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setReason(item.id)}
                  className={`flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition ${
                    reason === item.id
                      ? "border-[#FE2C55] bg-[#FE2C55]/15 text-white"
                      : "border-white/15 bg-black text-white hover:border-white/30"
                  }`}
                >
                  <span>
                    <span className="block font-bold">{item.label}</span>
                    <span className="block text-xs text-white/60">{item.hint}</span>
                  </span>
                </button>
              ))}
            </div>
            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={1000}
              placeholder="Add details (optional)"
              className="mt-3 h-20 w-full resize-none rounded-xl border border-white/15 bg-black p-3 text-sm text-white placeholder:text-white/40 outline-none focus:border-[#FE2C55]"
            />
            <Button
              disabled={!reason || busy}
              onClick={submit}
              className="mt-3 w-full rounded-full bg-[#FE2C55] text-white hover:bg-[#e9274d]"
            >
              {busy ? "Sending..." : "Submit report"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
