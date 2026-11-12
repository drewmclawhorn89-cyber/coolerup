import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  Circle,
  Film,
  Loader2,
  Square,
  Upload,
  Video,
  Wand2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import {
  MAX_GIF_SECONDS,
  MIN_GIF_SECONDS,
  convertVideoToGif,
  createGif,
  fetchVideoFile,
  formatGifSize,
  type GifRow,
  type GifSpeed,
} from "@/lib/gif";

type Step = "source" | "trim" | "edit" | "done";

type SourceKind = "mine" | "upload" | "record";

type Source = {
  kind: SourceKind;
  /** Playable URL (public storage URL or object URL). */
  url: string;
  /** Present for uploads/recordings; fetched lazily for own videos. */
  file?: File;
  videoId?: string | null;
  title: string;
};

type MyVideo = {
  id: string;
  caption: string | null;
  video_url: string;
  video_480_url: string | null;
  video_720_url: string | null;
};

const STICKERS = ["😂", "🔥", "💀", "❤️", "😭", "✨", "🐶", "🍕", "👀", "🎉", "💯", "😎"];

/** TikTok-style caption: white, heavy, black outline. */
const TEXT_STYLE = {
  font: "800 56px system-ui, -apple-system, 'Segoe UI', sans-serif",
  fill: "#ffffff",
  stroke: "#000000",
  lineWidth: 8,
};

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Draw the text + sticker into a transparent 480×480 PNG for ffmpeg. */
async function renderOverlay(text: string, sticker: string | null): Promise<Blob | null> {
  if (!text.trim() && !sticker) return null;
  const size = 480;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  if (text.trim()) {
    const lines = text.trim().slice(0, 80).split("\n").slice(0, 3);
    ctx.font = TEXT_STYLE.font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = TEXT_STYLE.lineWidth;
    ctx.strokeStyle = TEXT_STYLE.stroke;
    ctx.fillStyle = TEXT_STYLE.fill;
    const lineHeight = 64;
    const startY = size / 2 - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, i) => {
      const y = startY + i * lineHeight;
      ctx.strokeText(line, size / 2, y, size - 40);
      ctx.fillText(line, size / 2, y, size - 40);
    });
  }

  if (sticker) {
    ctx.font = "110px system-ui, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(sticker, size - 22, size - 18);
  }

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), "image/png"));
}

export function MakeGif({
  onCreated,
  onClose,
  className = "",
  expand = false,
}: {
  onCreated?: (gif: GifRow) => void;
  onClose?: () => void;
  className?: string;
  /** Let the panel grow with the page instead of scrolling inside itself. */
  expand?: boolean;
}) {
  const { user, handle, signIn } = useAuth();
  const [step, setStep] = useState<Step>("source");
  const [source, setSource] = useState<Source | null>(null);
  const [myVideos, setMyVideos] = useState<MyVideo[] | null>(null);
  const [loadingVideos, setLoadingVideos] = useState(false);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(MAX_GIF_SECONDS);
  const [playing, setPlaying] = useState(true);
  const [text, setText] = useState("");
  const [sticker, setSticker] = useState<string | null>(null);
  const [speed, setSpeed] = useState<GifSpeed>(1);
  const [cropSquare, setCropSquare] = useState(true);
  const [title, setTitle] = useState("");
  const [ownsVideo, setOwnsVideo] = useState(false);
  const [safetyError, setSafetyError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [stage, setStage] = useState("");
  const [result, setResult] = useState<GifRow | null>(null);
  const [resultSize, setResultSize] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordTimer = useRef<number | null>(null);
  const [recording, setRecording] = useState(false);
  const [recordCount, setRecordCount] = useState(3);
  const [recordUrl, setRecordUrl] = useState<string | null>(null);

  const ownHandle = handle ?? user?.email?.split("@")[0] ?? null;

  // Load the signed-in user's videos for the "My videos" source list.
  useEffect(() => {
    if (!user) {
      setMyVideos([]);
      return;
    }
    let alive = true;
    setLoadingVideos(true);
    const filter = ownHandle
      ? `user_id.eq.${user.id},username.eq."${ownHandle.replace(/"/g, "")}"`
      : `user_id.eq.${user.id}`;
    void supabase
      .from("videos")
      .select("id, caption, video_url, video_480_url, video_720_url")
      .or(filter)
      .order("created_at", { ascending: false })
      .limit(30)
      .then(({ data, error }) => {
        if (!alive) return;
        setLoadingVideos(false);
        if (error) {
          setMyVideos([]);
          return;
        }
        setMyVideos((data ?? []) as MyVideo[]);
      });
    return () => {
      alive = false;
    };
  }, [user, ownHandle]);

  // Clean up object URLs, recording timers and the camera when leaving.
  useEffect(() => {
    return () => {
      if (recordTimer.current) window.clearTimeout(recordTimer.current);
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Loop the preview between the trim handles, TikTok-style.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      if (v.currentTime >= end) v.currentTime = start;
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [end, start, step]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || step !== "trim") return;
    try {
      v.currentTime = start;
      if (playing) void v.play().catch(() => undefined);
      else v.pause();
    } catch {
      /* metadata not ready yet */
    }
  }, [start, step, playing]);

  const pickSource = (next: Source) => {
    setSource(next);
    setTitle(next.title || "My GIF");
    setOwnsVideo(next.kind !== "upload");
    setSafetyError(null);
    setDuration(0);
    setStart(0);
    setEnd(MAX_GIF_SECONDS);
    setStep("trim");
    setPlaying(true);
  };

  const onPickOwn = (video: MyVideo) => {
    const url = video.video_720_url || video.video_480_url || video.video_url;
    pickSource({
      kind: "mine",
      url,
      videoId: video.id,
      title: (video.caption ?? "My GIF").slice(0, 80),
    });
  };

  const onUpload = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      toast.error("Pick a video file.");
      return;
    }
    // Safety: a file that announces itself as a TikTok download is almost
    // always someone else's clip. Block it and explain why.
    if (/tiktok/i.test(file.name)) {
      setSafetyError(
        "Use your own video for GIF — TikTok videos without watermark + credit aren't allowed.",
      );
      return;
    }
    setSafetyError(null);
    pickSource({
      kind: "upload",
      url: URL.createObjectURL(file),
      file,
      title: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "My GIF",
    });
  };

  const stopRecording = useCallback(() => {
    if (recordTimer.current) {
      window.clearTimeout(recordTimer.current);
      recordTimer.current = null;
    }
    const rec = recorderRef.current;
    if (rec && rec.state === "recording") rec.stop();
  }, []);

  const startRecording = async () => {
    setSafetyError(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error("This device can't record video. Upload a clip instead.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
        audio: true,
      });
      streamRef.current = stream;
      const mime = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
        "video/mp4",
      ].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        setRecording(false);
        const blob = new Blob(chunks, { type: rec.mimeType || "video/webm" });
        if (blob.size === 0) {
          toast.error("Recording was empty — try again.");
          return;
        }
        const file = new File([blob], "recording.webm", { type: blob.type });
        const url = URL.createObjectURL(blob);
        setRecordUrl(url);
        pickSource({ kind: "record", url, file, title: "My GIF" });
      };
      recorderRef.current = rec;
      setRecording(true);
      setRecordCount(3);
      rec.start();
      let left = 3;
      const tick = () => {
        left -= 1;
        setRecordCount(Math.max(0, left));
        if (left <= 0) {
          stopRecording();
          return;
        }
        recordTimer.current = window.setTimeout(tick, 1000);
      };
      recordTimer.current = window.setTimeout(tick, 1000);
    } catch {
      toast.error("Camera/mic permission is needed to record a GIF.");
    }
  };

  const onMeta = () => {
    const v = videoRef.current;
    if (!v) return;
    const d = Number.isFinite(v.duration) ? v.duration : 0;
    setDuration(d);
    if (d > 0) {
      const firstEnd = Math.min(d, MAX_GIF_SECONDS);
      setStart(0);
      setEnd(Math.max(MIN_GIF_SECONDS, firstEnd));
    }
  };

  const changeStart = (value: number) => {
    const maxStart = Math.max(0, duration - MIN_GIF_SECONDS);
    const next = clamp(value, 0, maxStart);
    setStart(next);
    setEnd((prev) =>
      clamp(
        prev,
        next + MIN_GIF_SECONDS,
        Math.min(duration || MAX_GIF_SECONDS, next + MAX_GIF_SECONDS),
      ),
    );
  };

  const changeEnd = (value: number) => {
    const minEnd = start + MIN_GIF_SECONDS;
    const maxEnd = Math.min(duration || MAX_GIF_SECONDS, start + MAX_GIF_SECONDS);
    setEnd(clamp(value, minEnd, Math.max(minEnd, maxEnd)));
  };

  const outputDuration = useMemo(
    () => Math.min(end - start, MAX_GIF_SECONDS * speed) / speed,
    [end, start, speed],
  );

  const create = async () => {
    if (!user) {
      void signIn();
      return;
    }
    if (!source) return;
    if (source.kind === "upload" && !ownsVideo) {
      setSafetyError("Confirm this is your own video before making a GIF.");
      return;
    }
    if (/tiktok/i.test(title) && source.kind === "upload") {
      setSafetyError(
        "Use your own video for GIF — TikTok videos without watermark + credit aren't allowed.",
      );
      return;
    }
    setBusy(true);
    setProgress(0);
    setStage("Preparing");
    try {
      let file = source.file;
      if (!file) {
        setStage("Downloading video");
        file = await fetchVideoFile(source.url, (p) => setProgress(Math.round(p * 0.25)));
      }
      setStage("Loading GIF maker");
      const overlay = await renderOverlay(text, sticker);
      const out = await convertVideoToGif(
        file,
        { start, end, speed, cropSquare, overlay },
        (percent, label) => {
          setProgress(percent);
          setStage(label);
        },
      );
      setStage("Saving GIF");
      const row = await createGif({
        userId: user.id,
        username: ownHandle,
        blob: out.blob,
        title: title.trim() || "My GIF",
        sourceVideoId: source.videoId ?? null,
      });
      setResult(row);
      setResultSize(out.blob.size);
      setStep("done");
      toast.success("GIF created — find it in My GIFs");
      onCreated?.(row);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create that GIF.");
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setStep("source");
    setSource(null);
    setResult(null);
    setResultSize(0);
    setText("");
    setSticker(null);
    setSpeed(1);
    setCropSquare(true);
    setTitle("");
    setProgress(0);
    setStage("");
    setSafetyError(null);
    setRecordUrl(null);
  };

  const header = (
    <div className="flex items-center gap-2">
      {step !== "source" && step !== "done" && (
        <button
          type="button"
          onClick={() => setStep(step === "edit" ? "trim" : "source")}
          aria-label="Back"
          className="rounded-full p-1 hover:bg-secondary"
        >
          <ArrowLeft className="h-4 w-4" />
        </button>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">
          {step === "source" && "Make a GIF"}
          {step === "trim" && "Trim your GIF"}
          {step === "edit" && "Edit your GIF"}
          {step === "done" && "GIF created"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {step === "trim" && "Pick 0.5s – 3s · preview loops like TikTok"}
          {step === "edit" && "Text, sticker, speed, square crop"}
          {step === "source" && "From your videos, a 3s recording, or your phone"}
          {step === "done" && "Saved to My GIFs · others can use it"}
        </p>
      </div>
      {onClose && (
        <button type="button" onClick={onClose} aria-label="Close GIF maker">
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  return (
    <div
      className={`flex min-h-0 flex-col border-t ${
        expand ? "min-h-0 flex-1" : "max-h-[min(68dvh,30rem)]"
      } ${className}`}
    >
      {/* The header stays put; only the step body scrolls, so a long edit form
          (or a tall list of your videos) never gets clipped on a phone. */}
      <div className="shrink-0 px-3 pb-2 pt-3">{header}</div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 [-webkit-overflow-scrolling:touch]">
        {!user && step === "source" && (
          <div className="mt-3 rounded-lg bg-secondary/60 p-3 text-center">
            <p className="text-xs text-muted-foreground">Sign in to make GIFs from your videos.</p>
            <button
              type="button"
              onClick={() => void signIn()}
              className="mt-2 rounded-full bg-primary px-4 py-1.5 text-xs font-bold text-primary-foreground"
            >
              Sign in
            </button>
          </div>
        )}

        {user && step === "source" && (
          <div className="mt-3 space-y-3">
            {safetyError && (
              <div className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                {safetyError}
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => void startRecording()}
                disabled={recording}
                className="flex flex-col items-center gap-1 rounded-xl border bg-secondary/40 p-3 text-xs font-bold disabled:opacity-60"
              >
                <Circle className={`h-5 w-5 ${recording ? "animate-pulse text-red-500" : ""}`} />
                {recording ? `Recording ${recordCount}s` : "Record 3s"}
              </button>
              <button
                type="button"
                onClick={() => uploadRef.current?.click()}
                className="flex flex-col items-center gap-1 rounded-xl border bg-secondary/40 p-3 text-xs font-bold"
              >
                <Upload className="h-5 w-5" />
                Upload video
              </button>
            </div>
            <input
              ref={uploadRef}
              type="file"
              accept="video/*"
              className="hidden"
              onChange={(e) => onUpload(e.target.files?.[0])}
            />

            {recording && (
              <p className="rounded-lg bg-red-500/10 px-3 py-2 text-[11px] font-semibold text-red-500">
                Recording… keep it under 3 seconds. Camera preview stays on your device.
              </p>
            )}

            <div>
              <p className="mb-1 flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <Film className="h-3 w-3" /> My Coolerup videos
              </p>
              {loadingVideos && (
                <p className="text-xs text-muted-foreground">Loading your videos…</p>
              )}
              {!loadingVideos && myVideos?.length === 0 && (
                <p className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                  No videos yet. Record a 3s clip or upload one from your phone.
                </p>
              )}
              {/* No inner scroller: the step body scrolls, so a nested one would
                trap the gesture on phones. */}
              <div className="grid grid-cols-3 gap-1">
                {(myVideos ?? []).map((v) => (
                  <button
                    type="button"
                    key={v.id}
                    onClick={() => onPickOwn(v)}
                    className="relative overflow-hidden rounded-md bg-black"
                    aria-label={`Use ${v.caption || "video"}`}
                  >
                    <video
                      src={`${v.video_480_url || v.video_720_url || v.video_url}#t=0.1`}
                      muted
                      playsInline
                      preload="metadata"
                      className="h-20 w-full object-cover"
                    />
                    <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-left text-[9px] text-white">
                      {v.caption || "Video"}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
              Safety: only GIFs from <strong>your own</strong> videos. TikTok videos without a
              watermark + credit are blocked — “Use your own video for GIF”.
            </p>
          </div>
        )}

        {(step === "trim" || step === "edit") && source && (
          <div className="mt-3 space-y-3">
            <div className="relative mx-auto overflow-hidden rounded-xl bg-black">
              <video
                ref={videoRef}
                src={source.url}
                muted
                playsInline
                loop
                onLoadedMetadata={onMeta}
                className={`mx-auto max-h-56 w-full object-contain ${cropSquare ? "aspect-square" : ""}`}
              />
              {(text.trim() || sticker) && (
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-3 text-center">
                  {text.trim() && (
                    <p
                      className="max-w-full break-words text-lg font-extrabold leading-tight text-white"
                      style={{ textShadow: "0 0 6px #000, 2px 2px 0 #000, -2px -2px 0 #000" }}
                    >
                      {text}
                    </p>
                  )}
                  {sticker && <span className="absolute bottom-2 right-2 text-4xl">{sticker}</span>}
                </div>
              )}
              <button
                type="button"
                onClick={() => setPlaying((p) => !p)}
                className="absolute bottom-2 left-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-white"
              >
                {playing ? "Pause" : "Play"}
              </button>
              <span className="absolute bottom-2 right-2 rounded-full bg-black/60 px-2 py-1 text-[10px] font-bold text-white">
                {outputDuration.toFixed(1)}s GIF
              </span>
            </div>

            {step === "trim" && (
              <>
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                    <span>Start</span>
                    <span>{start.toFixed(1)}s</span>
                  </label>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.5, duration - MIN_GIF_SECONDS)}
                    step={0.1}
                    value={start}
                    onChange={(e) => changeStart(Number(e.target.value))}
                    className="w-full accent-primary"
                    aria-label="GIF start time"
                  />
                  <label className="flex items-center justify-between text-[11px] font-bold text-muted-foreground">
                    <span>End</span>
                    <span>{end.toFixed(1)}s</span>
                  </label>
                  <input
                    type="range"
                    min={start + MIN_GIF_SECONDS}
                    max={Math.min(duration || MAX_GIF_SECONDS, start + MAX_GIF_SECONDS)}
                    step={0.1}
                    value={end}
                    onChange={(e) => changeEnd(Number(e.target.value))}
                    className="w-full accent-primary"
                    aria-label="GIF end time"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {(end - start).toFixed(1)}s selected · max 3s · GIF loops automatically
                  </p>
                </div>
                <div className="sticky bottom-0 -mx-3 mt-2 border-t bg-card px-3 pb-1 pt-2">
                  <button
                    type="button"
                    onClick={() => setStep("edit")}
                    className="w-full rounded-full bg-primary py-2.5 text-sm font-bold text-primary-foreground"
                  >
                    Next: Edit
                  </button>
                </div>
              </>
            )}

            {step === "edit" && (
              <>
                <div className="space-y-2">
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value.slice(0, 80))}
                    placeholder="Add text on top (like TikTok)"
                    className="w-full rounded-full bg-secondary px-4 py-2 text-sm outline-none"
                  />
                  <div className="flex flex-wrap gap-1">
                    {STICKERS.map((s) => (
                      <button
                        type="button"
                        key={s}
                        onClick={() => setSticker((cur) => (cur === s ? null : s))}
                        className={`rounded-lg px-2 py-1 text-lg ${
                          sticker === s ? "bg-primary/20 ring-2 ring-primary" : "bg-secondary"
                        }`}
                        aria-label={`Sticker ${s}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    {(
                      [
                        { value: 0.5 as GifSpeed, label: "Slow" },
                        { value: 1 as GifSpeed, label: "Normal" },
                        { value: 2 as GifSpeed, label: "Fast" },
                      ] as const
                    ).map((s) => (
                      <button
                        type="button"
                        key={s.label}
                        onClick={() => setSpeed(s.value)}
                        className={`flex-1 rounded-full px-2 py-1.5 text-xs font-bold ${
                          speed === s.value ? "bg-primary text-primary-foreground" : "bg-secondary"
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setCropSquare((c) => !c)}
                      aria-pressed={cropSquare}
                      className={`flex items-center gap-1 rounded-full px-2 py-1.5 text-xs font-bold ${
                        cropSquare ? "bg-primary text-primary-foreground" : "bg-secondary"
                      }`}
                    >
                      <Square className="h-3 w-3" /> Square
                    </button>
                  </div>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, 80))}
                    placeholder="GIF title"
                    className="w-full rounded-full bg-secondary px-4 py-2 text-sm outline-none"
                  />
                  {source.kind === "upload" && (
                    <label className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
                      <input
                        type="checkbox"
                        checked={ownsVideo}
                        onChange={(e) => setOwnsVideo(e.target.checked)}
                        className="mt-0.5 accent-primary"
                      />
                      <span>
                        This is my own video. I understand stolen TikTok clips without watermark +
                        credit will be removed.
                      </span>
                    </label>
                  )}
                  {safetyError && (
                    <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                      {safetyError}
                    </p>
                  )}
                </div>

                <div className="sticky bottom-0 -mx-3 mt-2 border-t bg-card px-3 pb-1 pt-2">
                  {busy ? (
                    <div className="space-y-1 rounded-lg bg-secondary/60 p-3">
                      <div className="flex items-center gap-2 text-xs font-bold">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        {stage || "Working"} · {progress}%
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-background">
                        <div
                          className="h-full rounded-full bg-primary transition-all"
                          style={{ width: `${Math.max(3, progress)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        Converting on your device — nothing is uploaded until the GIF is ready.
                      </p>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => void create()}
                      className="flex w-full items-center justify-center gap-2 rounded-full bg-primary py-2.5 text-sm font-bold text-primary-foreground"
                    >
                      <Wand2 className="h-4 w-4" /> Create GIF
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {step === "done" && result && (
          <div className="mt-3 space-y-3 text-center">
            <img
              src={result.gif_url}
              alt={result.title}
              className="mx-auto max-h-56 rounded-xl border object-contain"
            />
            <div>
              <p className="text-sm font-bold">{result.title}</p>
              <p className="text-[11px] text-muted-foreground">
                Made by @{result.username ?? ownHandle ?? "you"} · {formatGifSize(resultSize)} ·{" "}
                {outputDuration.toFixed(1)}s
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={reset}
                className="flex-1 rounded-full bg-secondary py-2 text-xs font-bold"
              >
                Make another
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onClose) onClose();
                  else reset();
                }}
                className="flex flex-1 items-center justify-center gap-1 rounded-full bg-primary py-2 text-xs font-bold text-primary-foreground"
              >
                <Check className="h-3.5 w-3.5" /> Done
              </button>
            </div>
          </div>
        )}

        {step === "source" && recordUrl && !recording && (
          <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Video className="h-3 w-3" /> Recording ready — pick it above.
          </p>
        )}
      </div>
    </div>
  );
}
