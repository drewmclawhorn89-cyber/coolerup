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
  STORAGE_PREFIX,
  captureThumbnail,
  createFullVideo,
  finalizeFullVideo,
  formatDuration,
  fullVideoObjectPath,
  probeVideo,
  uploadFullVideoFiles,
  type UploadProgress,
} from "@/lib/fullVideos";
import { clearPendingVideo, registerPendingVideo } from "@/lib/pendingUploads";

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

/** "3.4 MB/s" — throughput, so a slow upload is visibly slow, not stuck. */
function formatSpeed(bytesPerSecond: number): string {
  const mb = bytesPerSecond / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(1)} MB/s`;
  return `${Math.max(1, Math.round(bytesPerSecond / 1024))} KB/s`;
}

/** "about 4 min left" */
function formatEta(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "estimating…";
  if (seconds < 5) return "almost done";
  if (seconds < 60) return `about ${Math.round(seconds)}s left`;
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `about ${mins} min left`;
  return `about ${(mins / 60).toFixed(1)} h left`;
}

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
  const [speed, setSpeed] = useState<UploadProgress | null>(null);
  const [uploaded, setUploaded] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The upload starts the moment a file is picked, not when Publish is hit, so
   * the bytes are already moving while the user types a title. `token` guards
   * against a stale upload from a file the user has since replaced.
   */
  const uploadRef = useRef<{
    token: number;
    promise: Promise<{ videoUrl: string; thumbnailUrl: string | null }>;
  } | null>(null);
  const tokenRef = useRef(0);
  /** Storage path reserved when the file was picked, so the row can point at it. */
  const videoPathRef = useRef<string>("");
  const [videoPath, setVideoPath] = useState("");

  // Release object URLs when they are replaced or the page unmounts.
  useEffect(() => () => {
    if (videoPreview) URL.revokeObjectURL(videoPreview);
  }, [videoPreview]);
  useEffect(() => () => {
    if (thumbPreview) URL.revokeObjectURL(thumbPreview);
  }, [thumbPreview]);

  /** Actions that must not be interrupted (reading the file, writing the row). */
  const busy = stage === "probing" || stage === "saving";
  /** The bytes are moving, but the form stays usable and Publish stays live. */
  const uploading = stage === "uploading";

  /**
   * Kick off the upload in the background. Resolves with the storage refs, and
   * drives the progress bar as bytes land. Safe to call repeatedly — each call
   * bumps the token so an older in-flight upload can't clobber the newer one.
   */
  function beginUpload(next: File, seconds: number) {
    if (!auth.user) {
      return Promise.reject(new Error("Sign in to upload a video."));
    }
    const token = ++tokenRef.current;
    setStage("uploading");
    setProgress(0);
    setUploaded(false);
    setError(null);

    const promise = (async () => {
      // Grab the poster frame *alongside* the upload, not before it. Waiting on
      // a decode before sending the first byte delayed every upload by a
      // noticeable beat — and for an exotic codec it could stall it entirely.
      const thumbPromise: Promise<Blob | null> = captureThumbnail(
        next,
        Math.min(1, seconds / 2),
      ).catch(() => null);

      void thumbPromise.then((thumb) => {
        if (!thumb || token !== tokenRef.current) return;
        setThumbBlob(thumb);
        setThumbPreview(URL.createObjectURL(thumb));
      });

      const result = await uploadFullVideoFiles(
        next,
        await thumbPromise,
        auth.user!.id,
        (percent, info) => {
          if (token !== tokenRef.current) return;
          setProgress(percent);
          if (info) setSpeed(info);
        },
        {
          ...(videoPathRef.current ? { videoPath: videoPathRef.current } : {}),
        },
      );
      if (token === tokenRef.current) {
        setProgress(100);
        setUploaded(true);
        setSpeed(null);
        setStage("idle");
      }
      return result;
    })();

    // Surface a background failure immediately rather than at Publish time.
    promise.catch((err) => {
      if (token !== tokenRef.current) return;
      uploadRef.current = null;
      setStage("idle");
      setProgress(0);
      setError(err instanceof Error ? err.message : "Upload failed. Try again.");
    });

    uploadRef.current = { token, promise };
    return promise;
  }

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
      const seconds = Math.round(meta.duration);
      // A 15-minute video is routinely 200–500 MB. Supabase's free plan caps a
      // single object at 50 MB, so warn up front rather than letting someone
      // watch a progress bar for twenty minutes before it fails.
      if (next.size > 50 * 1024 * 1024) {
        toast.warning(
          `This file is ${(next.size / (1024 * 1024)).toFixed(0)} MB. If your Supabase project is on the free plan (50 MB per file), the upload will fail — raise the limit in Storage → Settings first.`,
          { duration: 12_000 },
        );
      }
      // Reserve the destination now: the row is inserted before the upload
      // finishes, so both sides must agree on where the object will live.
      const reserved = fullVideoObjectPath(auth.user?.id ?? "anon", next.name);
      videoPathRef.current = reserved;
      setVideoPath(reserved);
      setFile(next);
      setDuration(seconds);
      setVideoPreview(URL.createObjectURL(next));
      if (!title) {
        setTitle(next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 100));
      }
      // Start pushing bytes now — the user still has a form to fill in.
      void beginUpload(next, seconds).catch(() => {});
    } catch (err) {
      setFile(null);
      setVideoPreview("");
      setDuration(0);
      setStage("idle");
      setError(err instanceof Error ? err.message : "That file could not be read.");
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
    setPublishing(true);
    try {
      // Publish *first*, upload second. The row goes in immediately so the
      // video is visible in the grid and playable from local disk within a
      // second, while the bytes keep moving in the background.
      setStage("saving");
      const created = await createFullVideo({
        userId: auth.user.id,
        username: auth.handle ?? auth.name ?? "coolerup",
        title,
        description,
        category,
        tags,
        duration,
        // Reserved up front so the row and the eventual object agree.
        videoUrl: `${STORAGE_PREFIX}${videoPath}`,
        thumbnailUrl: null,
        status: "processing",
      });

      // Let the watch page read straight off the user's disk until the real
      // object exists.
      registerPendingVideo(created.id, file, thumbPreview || null);

      const pending = uploadRef.current?.promise ?? beginUpload(file, duration);
      void pending
        .then(async ({ videoUrl, thumbnailUrl }) => {
          await finalizeFullVideo(created.id, { videoUrl, thumbnailUrl });
          clearPendingVideo(created.id);
        })
        .catch((err) => {
          // The row stays `processing`; surface it on the watch page rather
          // than silently showing a video that will never play.
          toast.error(
            err instanceof Error ? err.message : "The upload did not finish. Try again.",
          );
        });

      toast.success("Published — uploading in the background.");
      navigate({ to: "/watch/$id", params: { id: created.id } });
    } catch (err) {
      setStage("idle");
      setError(
        err instanceof Error ? err.message : "Upload failed. Check your connection and try again.",
      );
    } finally {
      setPublishing(false);
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
                    // Invalidate any in-flight upload so its progress and
                    // result can't land on the next file the user picks.
                    tokenRef.current += 1;
                    uploadRef.current = null;
                    videoPathRef.current = "";
                    setVideoPath("");
                    setFile(null);
                    setVideoPreview("");
                    setThumbBlob(null);
                    setThumbPreview("");
                    setDuration(0);
                    setProgress(0);
                    setUploaded(false);
                    setStage("idle");
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

        {(uploading || stage === "saving" || stage === "done" || uploaded) && (
          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">
                {stage === "saving"
                  ? "Finishing up…"
                  : stage === "done" || uploaded
                    ? "Video uploaded — ready to publish"
                    : `Uploading ${Math.round(progress)}%…`}
              </span>
              {stage === "done" || uploaded ? (
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
                style={{
                  width: `${stage === "saving" || stage === "done" || uploaded ? 100 : progress}%`,
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {uploaded
                ? "Bytes are in storage. Fill in the details and hit Publish."
                : speed && speed.bytesPerSecond > 0
                  ? `${formatSpeed(speed.bytesPerSecond)} · ${formatEta(speed.etaSeconds)} · keep this tab open`
                  : "Uploading in the background — keep this tab open while it finishes."}
            </p>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" asChild disabled={busy}>
            <Link to="/videos">Cancel</Link>
          </Button>
          <Button
            onClick={() => void submit()}
            disabled={publishing || stage === "probing" || stage === "saving" || !file || !auth.user}
            className="create-pink"
          >
            {publishing || stage === "saving" ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <Upload className="mr-2 size-4" />
            )}
            {publishing || stage === "saving"
              ? "Publishing…"
              : uploading
                ? `Publish (${Math.round(progress)}%)`
                : "Publish"}
          </Button>
        </div>
      </div>
    </div>
  );
}
