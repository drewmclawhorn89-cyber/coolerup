import { useEffect, useRef, useState } from "react";
import { Loader2, Scissors, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  isImageUrl,
  parseCaption,
  rebuildCaption,
  replaceVideoFile,
  resolveVideoUrl,
  updateVideoCaption,
  type Video,
} from "@/lib/loop";
import { MIN_TRIM_SECONDS, trimVideoFile, type TrimProgress } from "@/lib/videoEdit";

type Props = {
  video: Video;
  open: boolean;
  onClose: () => void;
  /** Fired with the values the card should patch in place after a save. */
  onSaved: (next: { caption: string; video_url?: string }) => void;
};

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

/**
 * Owner-only editor for a published Short.
 *
 * Two things can change: the caption and, for real video files, the in/out
 * points. Trimming re-encodes the clip in the browser, uploads it and repoints
 * the same row, so likes/comments/shares are untouched. Images and TikTok
 * imports have no local file to cut, so they only get the caption field.
 */
export function EditVideoDialog({ video, open, onClose, onSaved }: Props) {
  const previewRef = useRef<HTMLVideoElement | null>(null);

  const isImage =
    isImageUrl(video.video_url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(video.video_url);
  const isTikTok = Boolean(video.is_tiktok && video.tiktok_id);
  const canTrim = !isImage && !isTikTok;

  const [caption, setCaption] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<TrimProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-seed whenever a different video (or a fresh open) comes in.
  useEffect(() => {
    if (!open) return;
    setCaption(parseCaption(video.caption).text);
    setDuration(0);
    setStart(0);
    setEnd(0);
    setSaving(false);
    setProgress(null);
    setError(null);
  }, [open, video.id, video.caption]);

  // Resolve the playable URL for the preview.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    setPreviewSrc("");
    void resolveVideoUrl(video.video_url).then((url) => {
      if (alive) setPreviewSrc(url);
    });
    return () => {
      alive = false;
    };
  }, [open, video.video_url]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, onClose]);

  if (!open) return null;

  const trimStart = canTrim ? start : 0;
  const trimEnd = canTrim ? end : duration;
  const trimmed = canTrim && duration > 0 && (trimStart > 0.05 || trimEnd < duration - 0.05);
  const trimmedLength = Math.max(0, trimEnd - trimStart);

  function seekTo(seconds: number) {
    const el = previewRef.current;
    if (!el) return;
    try {
      el.currentTime = seconds;
    } catch {
      /* metadata not ready yet */
    }
  }

  async function save() {
    if (saving) return;
    setError(null);
    const nextCaption = rebuildCaption(caption, video.caption);

    if (trimmed && trimmedLength < MIN_TRIM_SECONDS) {
      setError(`Keep at least ${MIN_TRIM_SECONDS} second of video.`);
      return;
    }

    setSaving(true);
    try {
      if (trimmed) {
        if (!previewSrc) throw new Error("Couldn't load the video to trim it.");
        setProgress({ percent: 0, stage: "Preparing" });
        const resp = await fetch(previewSrc);
        if (!resp.ok) throw new Error("Couldn't download the video to trim it.");
        const blob = await resp.blob();
        const file = new File([blob], `${video.id}.mp4`, { type: blob.type || "video/mp4" });
        const cut = await trimVideoFile(file, trimStart, trimEnd, setProgress);
        const next = await replaceVideoFile(video, cut, nextCaption);
        onSaved(next);
        toast.success("Video updated");
      } else {
        await updateVideoCaption(video.id, nextCaption);
        onSaved({ caption: nextCaption });
        toast.success("Caption updated");
      }
      onClose();
    } catch (err) {
      console.error(err);
      const message =
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save your changes. Try again.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !saving && onClose()}
        className="absolute inset-0 bg-black/60"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Edit video"
        className="relative flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-background text-foreground shadow-2xl sm:rounded-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-base font-bold">Edit video</h2>
          <button
            type="button"
            onClick={() => !saving && onClose()}
            aria-label="Close"
            className="rounded-full p-1.5 hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="overflow-hidden rounded-xl bg-black">
            {isImage ? (
              previewSrc ? (
                <img src={previewSrc} alt="" className="mx-auto max-h-[38vh] object-contain" />
              ) : (
                <div className="flex h-40 items-center justify-center text-xs text-zinc-400">
                  Loading preview…
                </div>
              )
            ) : isTikTok ? (
              <div className="flex h-40 items-center justify-center px-6 text-center text-xs text-zinc-400">
                TikTok imports can't be trimmed here — you can still edit the caption.
              </div>
            ) : (
              <video
                ref={previewRef}
                src={previewSrc || undefined}
                controls
                playsInline
                preload="metadata"
                className="mx-auto max-h-[38vh] w-full object-contain"
                onLoadedMetadata={(e) => {
                  const d = e.currentTarget.duration;
                  if (Number.isFinite(d) && d > 0) {
                    setDuration(d);
                    setStart(0);
                    setEnd(d);
                  }
                }}
              />
            )}
          </div>

          {canTrim && (
            <div className="space-y-3 rounded-xl border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold">
                  <Scissors className="size-3.5" /> Trim clip
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {trimmed ? `${formatTime(trimmedLength)} selected` : "Full length"}
                </span>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <label htmlFor="trim-start">Start</label>
                  <span>{formatTime(trimStart)}</span>
                </div>
                <input
                  id="trim-start"
                  type="range"
                  min={0}
                  max={Math.max(0, duration)}
                  step={0.1}
                  value={trimStart}
                  disabled={!duration || saving}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setStart(Math.min(v, trimEnd - MIN_TRIM_SECONDS));
                    seekTo(v);
                  }}
                  className="w-full accent-primary"
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                  <label htmlFor="trim-end">End</label>
                  <span>{formatTime(trimEnd)}</span>
                </div>
                <input
                  id="trim-end"
                  type="range"
                  min={0}
                  max={Math.max(0, duration)}
                  step={0.1}
                  value={trimEnd}
                  disabled={!duration || saving}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setEnd(Math.max(v, trimStart + MIN_TRIM_SECONDS));
                    seekTo(v);
                  }}
                  className="w-full accent-primary"
                />
              </div>

              {trimmed && (
                <button
                  type="button"
                  onClick={() => {
                    setStart(0);
                    setEnd(duration);
                    seekTo(0);
                  }}
                  className="text-[11px] font-medium text-primary hover:underline"
                  disabled={saving}
                >
                  Reset to full length
                </button>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="edit-caption" className="text-xs font-medium text-muted-foreground">
              Caption
            </label>
            <Textarea
              id="edit-caption"
              value={caption}
              maxLength={2200}
              rows={3}
              placeholder="Say something about this video…"
              onChange={(e) => setCaption(e.target.value)}
              disabled={saving}
            />
            <p className="text-right text-[11px] text-muted-foreground">{caption.length}/2200</p>
          </div>

          {progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{progress.stage}…</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving…
              </>
            ) : trimmed ? (
              "Save trimmed video"
            ) : (
              "Save changes"
            )}
          </Button>
        </footer>
      </div>
    </div>
  );
}
