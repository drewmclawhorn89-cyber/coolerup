import { useState } from "react";
import { ArrowLeft, Download, Flag, Forward, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { ReportDialog } from "@/components/ReportDialog";
import { Button } from "@/components/ui/button";
import {
  deleteDirectMessage,
  isViewOnceExpired,
  saveDmMediaToDevice,
  sendDirectMessage,
  type DirectMessage,
} from "@/lib/dmMedia";
import { WatermarkError, watermarkCause } from "@/lib/watermark";

export function DmMediaActionSheet({
  msg,
  resolvedUrl,
  myUserId,
  myHandle,
  recentRecipients,
  onClose,
  onDeleted,
  onForwarded,
}: {
  msg: DirectMessage;
  resolvedUrl?: string | undefined;
  myUserId: string;
  myHandle: string;
  recentRecipients: string[];
  onClose: () => void;
  onDeleted: (id: string) => void;
  onForwarded?: ((newMsg?: DirectMessage) => void) | undefined;
}) {
  const [mode, setMode] = useState<"menu" | "forward">("menu");
  const [forwardTo, setForwardTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);

  const expired = isViewOnceExpired(msg);
  const viewOnceLocked = msg.view_once || expired;
  const hasMedia = Boolean(msg.media_url || msg.gif_url);

  const handleSave = async () => {
    if (viewOnceLocked) {
      toast.error("View Once media cannot be saved.");
      return;
    }
    const toastId = toast.loading("Saving media...");
    setBusy(true);
    try {
      const res = await saveDmMediaToDevice({
        msg,
        ...(resolvedUrl ? { resolvedUrl } : {}),
        onProgress: ({ percent, stage }) =>
          toast.loading(`${stage}... ${percent}%`, { id: toastId }),
      });
      toast.success(res.shared ? "Shared" : "Saved", { id: toastId });
      onClose();
    } catch (err) {
      toast.error(
        err instanceof WatermarkError
          ? `Couldn't prepare watermarked download (${watermarkCause(err) || "try again"}).`
          : err instanceof Error
            ? err.message
            : "Couldn't save media.",
        { id: toastId },
      );
    } finally {
      setBusy(false);
    }
  };

  const handleForwardSend = async (recipient: string) => {
    const clean = recipient.trim().replace(/^@+/, "").toLowerCase();
    if (!clean) {
      toast.error("Enter a @username to forward to.");
      return;
    }
    if (viewOnceLocked) {
      toast.error("View Once media cannot be forwarded.");
      return;
    }
    setBusy(true);
    try {
      const res = await sendDirectMessage({
        fromId: myUserId,
        fromUsername: myHandle,
        toUsername: clean,
        message: msg.message || "",
        gifUrl: msg.gif_url,
        gifCredit: msg.gif_credit,
        mediaUrl: msg.media_url,
        mediaType: msg.media_type,
        mediaVideoId: msg.media_video_id,
        mediaCaption: msg.media_caption,
        mediaHasExternalWatermark: msg.media_has_external_watermark,
        viewOnce: false,
      });
      if (!res.ok) {
        toast.error(res.error || "Couldn't forward message.");
        return;
      }
      toast.success(`Forwarded to @${clean}`);
      onForwarded?.(res.row);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    setBusy(true);
    try {
      const res = await deleteDirectMessage(msg.id);
      if (!res.ok) {
        toast.error(res.error || "Couldn't delete message.");
        return;
      }
      toast.success("Message deleted");
      onDeleted(msg.id);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  if (reportOpen) {
    const httpThumb =
      resolvedUrl && (resolvedUrl.startsWith("https://") || resolvedUrl.startsWith("http://"))
        ? resolvedUrl
        : msg.gif_url;
    return (
      <ReportDialog
        username={msg.from_username}
        {...(msg.media_video_id ? { videoId: msg.media_video_id } : {})}
        target={msg.media_video_id ? "video" : "message"}
        targetUrl={typeof window !== "undefined" ? window.location.href : null}
        targetText={
          msg.media_caption ||
          msg.message ||
          `Direct message ${msg.media_type ?? "media"} from @${msg.from_username}`
        }
        thumbnailUrl={httpThumb}
        onClose={() => {
          setReportOpen(false);
          onClose();
        }}
      />
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/80 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded-t-3xl border border-white/15 bg-black p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-white sm:rounded-3xl"
      >
        {mode === "menu" ? (
          <>
            <div className="mb-3 flex items-center justify-between">
              <p className="text-sm font-bold text-white">Message options</p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close options"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white/70 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {hasMedia && !viewOnceLocked && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSave()}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-white/10 bg-zinc-950 px-4 text-left text-sm font-semibold text-white hover:bg-zinc-900 disabled:opacity-50"
                >
                  <Download className="h-4 w-4 text-primary" />
                  <span>Save</span>
                </button>
              )}

              {hasMedia && !viewOnceLocked && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMode("forward")}
                  className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-white/10 bg-zinc-950 px-4 text-left text-sm font-semibold text-white hover:bg-zinc-900 disabled:opacity-50"
                >
                  <Forward className="h-4 w-4 text-primary" />
                  <span>Forward</span>
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => void handleDelete()}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-white/10 bg-zinc-950 px-4 text-left text-sm font-semibold text-white hover:bg-zinc-900 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4 text-rose-400" />
                <span>Delete</span>
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => setReportOpen(true)}
                className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-white/10 bg-zinc-950 px-4 text-left text-sm font-semibold text-[#FE2C55] hover:bg-zinc-900 disabled:opacity-50"
              >
                <Flag className="h-4 w-4" />
                <span>Report</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setMode("menu")}
                className="inline-flex items-center gap-1.5 text-sm font-semibold text-white/80 hover:text-white"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <p className="text-sm font-bold text-white">Forward to</p>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-white/70 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex gap-2">
              <input
                value={forwardTo}
                onChange={(e) => setForwardTo(e.target.value)}
                placeholder="@username"
                className="min-w-0 flex-1 rounded-full border border-white/15 bg-zinc-900 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-primary"
              />
              <Button
                type="button"
                disabled={busy || !forwardTo.trim()}
                onClick={() => void handleForwardSend(forwardTo)}
                className="rounded-full"
              >
                Send
              </Button>
            </div>

            {recentRecipients.length > 0 && (
              <div className="mt-3 max-h-48 space-y-1.5 overflow-y-auto">
                <p className="px-1 text-[11px] font-bold uppercase tracking-wider text-white/50">
                  Recent chats
                </p>
                {recentRecipients.map((u) => (
                  <button
                    key={u}
                    type="button"
                    disabled={busy}
                    onClick={() => void handleForwardSend(u)}
                    className="flex min-h-[44px] w-full items-center justify-between rounded-xl border border-white/10 bg-zinc-950 px-3 text-left text-sm font-medium text-white hover:bg-zinc-900"
                  >
                    <span>@{u}</span>
                    <span className="text-xs font-semibold text-primary">Forward</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
