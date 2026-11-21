import { useState } from "react";
import { Flag, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";

const REASONS = [
  ["sexual", "Sexual / explicit"],
  ["harassment", "Bullying / harassment"],
  ["hate", "Hate speech"],
  ["violence", "Threats / violence"],
  ["spam", "Spam / scam"],
  ["minor", "Involves a minor"],
  ["other", "Something else"],
] as const;

type ReasonId = (typeof REASONS)[number][0];

/**
 * One report button for everything.
 *
 * Drop it on a video, a comment or a profile. It writes to the same `reports`
 * table the /admin screen already reads, so a report filed from any surface
 * shows up in one queue. Comment and profile reports carry a `[comment:<id>]`
 * / `[profile]` marker in `details` so the reviewer knows what they are looking
 * at even though the table only has a video column.
 */
export function ReportButton({
  username,
  videoId,
  commentId,
  target = "video",
  className = "",
  label,
  iconClassName = "h-3.5 w-3.5",
}: {
  username: string;
  videoId?: string | null;
  commentId?: string | null;
  target?: "video" | "comment" | "profile";
  className?: string;
  label?: string;
  iconClassName?: string;
}) {
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReasonId | null>(null);
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
    if (!auth.user || !auth.handle) return;
    if (!reason) return;
    setBusy(true);

    const marker =
      target === "comment" && commentId
        ? `[comment:${commentId}] `
        : target === "profile"
          ? "[profile] "
          : "";

    const { error } = await supabase.from("reports").insert({
      reporter_id: auth.user.id,
      reporter_username: auth.handle,
      reported_username: username,
      reported_video_id: videoId ?? null,
      video_id: videoId ?? null,
      reason,
      details: `${marker}${details.trim()}`.slice(0, 1000) || null,
    });

    setBusy(false);
    if (error) {
      console.error("report failed", error);
      toast.error("Couldn't send report");
      return;
    }
    toast.success("Report sent. We review within 24 hours.");
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
            className="w-full max-w-sm rounded-t-3xl border border-white/10 bg-black p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white sm:rounded-3xl"
          >
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold">Report @{username}</h2>
                <p className="text-xs text-white/50">
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
                className="rounded-full p-1.5 text-white/50 hover:bg-white/10 hover:text-white"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {REASONS.map(([id, text]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setReason(id)}
                  className="flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left text-sm transition-colors"
                  style={{
                    borderColor: reason === id ? "#FE2C55" : "rgba(255,255,255,0.12)",
                    backgroundColor: reason === id ? "rgba(254,44,85,0.12)" : "transparent",
                  }}
                >
                  <span>{text}</span>
                  {reason === id && (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: "#FE2C55" }}
                    />
                  )}
                </button>
              ))}
            </div>

            <textarea
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              placeholder="Anything else we should know? (optional)"
              maxLength={500}
              rows={2}
              className="mt-3 w-full resize-none rounded-lg border border-white/12 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-white/35 focus:outline-none"
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
