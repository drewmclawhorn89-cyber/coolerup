import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  FULL_VIDEO_CATEGORIES,
  deleteFullVideo,
  resolveFullVideoUrl,
  updateFullVideo,
  uploadFullVideoThumbnail,
  type FullVideo,
} from "@/lib/fullVideos";

type Props = {
  video: FullVideo;
  userId: string;
  open: boolean;
  onClose: () => void;
  /** Fired with the updated row so the parent list can patch in place. */
  onSaved: (next: FullVideo) => void;
  /** Fired after a successful delete so the parent can drop the row. */
  onDeleted?: (id: string) => void;
};

/**
 * Owner-only editor for a published full video.
 *
 * Deliberately edits metadata only — title, description, category, tags and
 * thumbnail. The video file itself is immutable: swapping it would invalidate
 * the URL people already shared, so re-uploading means posting a new video.
 */
export function EditFullVideoDialog({ video, userId, open, onClose, onSaved, onDeleted }: Props) {
  const thumbInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState(video.title);
  const [description, setDescription] = useState(video.description ?? "");
  const [category, setCategory] = useState(video.category || "Music");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>(video.tags ?? []);

  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [thumbPreview, setThumbPreview] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever a different video is opened.
  useEffect(() => {
    if (!open) return;
    setTitle(video.title);
    setDescription(video.description ?? "");
    setCategory(video.category || "Music");
    setTags(video.tags ?? []);
    setTagInput("");
    setThumbBlob(null);
    setThumbPreview("");
    setConfirmDelete(false);
    setError(null);
  }, [open, video]);

  // Existing thumbnail, resolved to a signed URL for the preview.
  useEffect(() => {
    if (!open || !video.thumbnail_url) return;
    let alive = true;
    void resolveFullVideoUrl(video.thumbnail_url).then((u) => {
      if (alive) setThumbPreview((prev) => prev || u);
    });
    return () => {
      alive = false;
    };
  }, [open, video.thumbnail_url]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving && !deleting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, saving, deleting, onClose]);

  if (!open) return null;

  function addTag(raw: string) {
    const clean = raw.replace(/^#/, "").trim().slice(0, 24);
    if (!clean) return;
    setTags((prev) =>
      prev.some((t) => t.toLowerCase() === clean.toLowerCase()) || prev.length >= 8
        ? prev
        : [...prev, clean],
    );
    setTagInput("");
  }

  async function save() {
    setError(null);
    if (title.trim().length < 3) {
      setError("Give your video a title of at least 3 characters.");
      return;
    }
    setSaving(true);
    try {
      const thumbnailUrl = thumbBlob ? await uploadFullVideoThumbnail(thumbBlob, userId) : undefined;
      const next = await updateFullVideo(video.id, userId, {
        title,
        description,
        category,
        tags,
        ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
      });
      onSaved(next);
      toast.success("Video updated");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save your changes.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setDeleting(true);
    try {
      await deleteFullVideo(video.id, userId);
      onDeleted?.(video.id);
      toast.success("Video deleted");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete this video.");
      setDeleting(false);
    }
  }

  const busy = saving || deleting;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={() => !busy && onClose()}
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
            onClick={() => !busy && onClose()}
            aria-label="Close"
            className="rounded-full p-1.5 hover:bg-muted"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <div className="space-y-1.5">
            <label htmlFor="edit-title" className="text-xs font-medium text-muted-foreground">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="edit-title"
              value={title}
              maxLength={100}
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-right text-[11px] text-muted-foreground">{title.length}/100</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-desc" className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <Textarea
              id="edit-desc"
              value={description}
              rows={4}
              maxLength={5000}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Thumbnail</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => thumbInputRef.current?.click()}
                className="relative aspect-video w-36 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
              >
                {thumbPreview ? (
                  <img src={thumbPreview} alt="" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImagePlus className="size-5" />
                    <span className="text-[11px]">Add</span>
                  </span>
                )}
              </button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => thumbInputRef.current?.click()}
              >
                Change thumbnail
              </Button>
            </div>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const next = e.target.files?.[0];
                e.target.value = "";
                if (!next) return;
                if (!next.type.startsWith("image/")) {
                  toast.error("Pick an image file for the thumbnail.");
                  return;
                }
                setThumbBlob(next);
                setThumbPreview(URL.createObjectURL(next));
              }}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Category</span>
            <div className="flex flex-wrap gap-2">
              {FULL_VIDEO_CATEGORIES.filter((c) => c !== "All").map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={category === c}
                  onClick={() => setCategory(c)}
                  className={
                    category === c
                      ? "rounded-full bg-foreground px-3 py-1.5 text-xs font-semibold text-background"
                      : "rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  }
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="edit-tags" className="text-xs font-medium text-muted-foreground">
              Tags
            </label>
            <Input
              id="edit-tags"
              value={tagInput}
              placeholder="Type a tag and press Enter"
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag(tagInput);
                }
              }}
              onBlur={() => addTag(tagInput)}
            />
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
                  >
                    #{t}
                    <button
                      type="button"
                      aria-label={`Remove tag ${t}`}
                      onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    >
                      <X className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="border-t border-border pt-3">
            <Button
              type="button"
              variant="ghost"
              onClick={() => void remove()}
              disabled={busy}
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            >
              {deleting ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 size-4" />
              )}
              {confirmDelete ? "Tap again to confirm delete" : "Delete video"}
            </Button>
          </div>
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={busy} className="create-pink">
            {saving && <Loader2 className="mr-2 size-4 animate-spin" />}
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </footer>
      </div>
    </div>
  );
}
