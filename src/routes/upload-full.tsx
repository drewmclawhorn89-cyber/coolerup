import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  ImagePlus,
  Loader2,
  Upload,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  FULL_VIDEO_CATEGORIES,
  MAX_FULL_VIDEO_SECONDS,
  captureThumbnail,
  createFullVideo,
  formatDuration,
  probeVideo,
  uploadFullVideoFiles,
} from "@/lib/fullVideos";

export const Route = createFileRoute("/upload-full")({
  head: () => ({
    meta: [
      { title: "Upload a full video — Coolerup" },
      {
        name: "description",
        content:
          "Upload full-length videos up to 60 minutes to Coolerup — title, description, thumbnail, category and tags.",
      },
      { property: "og:title", content: "Upload a full video — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: UploadFullPage,
});

type Stage = "idle" | "probing" | "uploading" | "saving" | "done";

function UploadFullPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const thumbInputRef = useRef<HTMLInputElement | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [videoPreview, setVideoPreview] = useState<string>("");
  const [duration, setDuration] = useState(0);
  const [thumbBlob, setThumbBlob] = useState<Blob | null>(null);
  const [thumbPreview, setThumbPreview] = useState<string>("");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<string>("Music");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);

  const [stage, setStage] = useState<Stage>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Release object URLs when they are replaced or the page unmounts.
  useEffect(() => () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
  }, [videoPreview]);
  useEffect(() => () => {
    if (thumbPreview) URL.revokeObjectURL(thumbPreview);
  }, [thumbPreview]);

  const busy = stage === "probing" || stage === "uploading" || stage === "saving";

  async function handleFile(next: File) {
    setError(null);
    setStage("probing");
    try {
      const meta = await probeVideo(next);
      if (!Number.isFinite(meta.duration) || meta.duration <= 0) {
        throw new Error("We couldn't read that video. Try a different file.");
      }
      if (meta.duration > MAX_FULL_VIDEO_SECONDS + 1) {
        throw new Error(
          `That video is ${formatDuration(Math.round(meta.duration))}. Full videos can be up to 60 minutes.`,
        );
      }
      setFile(next);
      setDuration(Math.round(meta.duration));
      setVideoPreview(URL.createObjectURL(next));

      // Auto-grab a thumbnail one second in so the card is never blank.
      const grabbed = await captureThumbnail(next, Math.min(1, meta.duration / 2));
      if (grabbed) {
        setThumbBlob(grabbed);
        setThumbPreview(URL.createObjectURL(grabbed));
      }
      if (!title) {
        setTitle(next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100));
      }
    } catch (err) {
      setFile(null);
      setVideoPreview("");
      setDuration(0);
      setError(err instanceof Error ? err.message : "That file could not be read.");
    } finally {
      setStage("idle");
    }
  }

  async function handleThumb(next: File) {
    if (!next.type.startsWith("image/")) {
      toast.error("Pick an image file for the thumbnail.");
      return;
    }
    setThumbBlob(next);
    setThumbPreview(URL.createObjectURL(next));
  }

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

  async function submit() {
    if (!auth.user) {
      toast.error("Sign in to upload a video.");
      return;
    }
    if (!file) {
      setError("Choose a video file first.");
      return;
    }
    if (title.trim().length < 3) {
      setError("Give your video a title of at least 3 characters.");
      return;
    }

    setError(null);
    setProgress(0);
    setStage("uploading");
    try {
      const { videoUrl, thumbnailUrl } = await uploadFullVideoFiles(
        file,
        thumbBlob,
        auth.user.id,
        (percent) => setProgress(percent),
      );

      setStage("saving");
      const created = await createFullVideo({
        userId: auth.user.id,
        username: auth.handle ?? auth.name ?? "coolerup",
        title,
        description,
        category,
        tags,
        duration,
        videoUrl,
        thumbnailUrl,
      });

      setStage("done");
      toast.success("Uploaded — going live now.");
      navigate({ to: "/watch/$id", params: { id: created.id } });
    } catch (err) {
      setStage("idle");
      setError(
        err instanceof Error ? err.message : "Upload failed. Check your connection and try again.",
      );
    }
  }

  if (!auth.ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24 text-foreground">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <Link
          to="/videos"
          className="flex size-9 items-center justify-center rounded-full hover:bg-muted"
          aria-label="Back to videos"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-base font-bold">Upload a full video</h1>
      </header>

      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-5">
        {!auth.user && (
          <div className="rounded-xl border border-border bg-card p-4 text-sm">
            You need an account to upload.{" "}
            <button
              type="button"
              onClick={() => void auth.signIn()}
              className="font-semibold text-primary underline"
            >
              Sign in
            </button>
          </div>
        )}

        {/* Step 1 — the file */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Video</h2>
            <span className="text-xs text-muted-foreground">Up to 60 minutes</span>
          </div>

          {file ? (
            <div className="overflow-hidden rounded-xl border border-border bg-card">
              <video
                src={videoPreview}
                controls
                playsInline
                className="aspect-video w-full bg-black"
              />
              <div className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDuration(duration)} · {(file.size / (1024 * 1024)).toFixed(1)} MB
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => {
                    setFile(null);
                    setVideoPreview("");
                    setThumbBlob(null);
                    setThumbPreview("");
                    setDuration(0);
                  }}
                >
                  <X className="mr-1 size-4" /> Remove
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-card px-4 py-12 text-center transition hover:border-primary/60 hover:bg-muted/40 disabled:opacity-60"
            >
              {stage === "probing" ? (
                <Loader2 className="size-8 animate-spin text-muted-foreground" />
              ) : (
                <Upload className="size-8 text-muted-foreground" />
              )}
              <span className="text-sm font-semibold">
                {stage === "probing" ? "Reading video…" : "Select a video to upload"}
              </span>
              <span className="text-xs text-muted-foreground">
                MP4, MOV or WebM · horizontal or vertical · max 60 minutes
              </span>
            </button>
          )}

          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            className="hidden"
            onChange={(e) => {
              const next = e.target.files?.[0];
              e.target.value = "";
              if (next) void handleFile(next);
            }}
          />
        </section>

        {/* Step 2 — details */}
        <section className="space-y-4">
          <h2 className="text-sm font-semibold">Details</h2>

          <div className="space-y-1.5">
            <label htmlFor="title" className="text-xs font-medium text-muted-foreground">
              Title <span className="text-destructive">*</span>
            </label>
            <Input
              id="title"
              value={title}
              maxLength={100}
              placeholder="An interesting title"
              onChange={(e) => setTitle(e.target.value)}
            />
            <p className="text-right text-[11px] text-muted-foreground">{title.length}/100</p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="description" className="text-xs font-medium text-muted-foreground">
              Description
            </label>
            <Textarea
              id="description"
              value={description}
              maxLength={5000}
              rows={5}
              placeholder="Tell viewers about your video"
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Thumbnail</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => thumbInputRef.current?.click()}
                className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-lg border border-border bg-muted"
              >
                {thumbPreview ? (
                  <img src={thumbPreview} alt="Thumbnail preview" className="size-full object-cover" />
                ) : (
                  <span className="flex size-full flex-col items-center justify-center gap-1 text-muted-foreground">
                    <ImagePlus className="size-5" />
                    <span className="text-[11px]">Add</span>
                  </span>
                )}
              </button>
              <div className="text-xs text-muted-foreground">
                <p>We grab a frame automatically — upload your own to replace it.</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  onClick={() => thumbInputRef.current?.click()}
                >
                  Change thumbnail
                </Button>
              </div>
            </div>
            <input
              ref={thumbInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const next = e.target.files?.[0];
                e.target.value = "";
                if (next) void handleThumb(next);
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
            <label htmlFor="tags" className="text-xs font-medium text-muted-foreground">
              Tags
            </label>
            <Input
              id="tags"
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
            <p className="text-[11px] text-muted-foreground">Up to 8 tags.</p>
          </div>
        </section>

        {error && (
          <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {(stage === "uploading" || stage === "saving" || stage === "done") && (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {stage === "uploading"
                  ? `Uploading ${Math.round(progress)}%…`
                  : stage === "saving"
                    ? "Finishing up…"
                    : "Uploaded"}
              </span>
              {stage === "done" ? (
                <CheckCircle2 className="size-4 text-emerald-500" />
              ) : (
                <span className="tabular-nums text-xs text-muted-foreground">
                  {Math.round(progress)}%
                </span>
              )}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300"
                style={{ width: `${stage === "saving" || stage === "done" ? 100 : progress}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Chunked upload — you can leave this tab open while it finishes.
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" asChild disabled={busy}>
            <Link to="/videos">Cancel</Link>
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={busy || !file || !auth.user}
            className="create-pink"
          >
            {busy ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
            {busy ? "Uploading…" : "Publish"}
          </Button>
        </div>
      </div>
    </div>
  );
}
