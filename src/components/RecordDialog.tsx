import { useEffect, useRef, useState } from "react";
import { Camera, Loader2, Music, RefreshCw, RotateCcw, Send, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { uploadRecording } from "@/lib/loop";
import { FilterBar } from "@/components/FilterBar";
import { AnimalOverlay } from "@/components/AnimalOverlay";
import { getAnimal, drawAnimal } from "@/lib/animals";
import { useFaceTracker } from "@/lib/face";
import { CAMERA_FILTERS, canBakeFilters } from "@/lib/filters";
import { SoundPickerDialog } from "@/components/SoundPickerDialog";
import type { Sound } from "@/lib/sounds";

const MAX_SECONDS = 60;
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
  "video/mp4",
];

type CameraState = "loading" | "ready" | "denied" | "unsupported" | "error";
type FacingMode = "user" | "environment";

function pickMimeType() {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return undefined;
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function formatTime(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function RecordDialog({
  open,
  onOpenChange,
  username,
  onPosted,
  onUploadInstead,
  sound,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  username?: string | null;
  onPosted?: () => void;
  onUploadInstead?: () => void;
  /** Pre-selected sound ("Use this sound" from a sound page). */
  sound?: Sound | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const discardRef = useRef(false);
  const startedAtRef = useRef(0);
  const drawRef = useRef(0);
  const [filterId, setFilterId] = useState("none");
  const [animalId, setAnimalId] = useState("");
  const animal = getAnimal(animalId);
  const filter = CAMERA_FILTERS.find((f) => f.id === filterId) ?? CAMERA_FILTERS[0]!;

  const [facingMode, setFacingMode] = useState<FacingMode>("user");
  const [cameraState, setCameraState] = useState<CameraState>("loading");
  const [cameraAttempt, setCameraAttempt] = useState(0);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const faceRef = useFaceTracker(videoRef, !!animal && open && !recordedBlob);
  const [previewUrl, setPreviewUrl] = useState("");
  const [caption, setCaption] = useState("");
  const [posting, setPosting] = useState(false);
  const [chosenSound, setChosenSound] = useState<Sound | null>(sound ?? null);
  const [soundPickerOpen, setSoundPickerOpen] = useState(false);
  const autoOpenedSound = useRef(false);

  // A sound page can open the recorder with a sound already selected.
  useEffect(() => {
    if (open) setChosenSound(sound ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, sound?.id]);

  // After recording, ask "Add sound?" once (TikTok's post-record step).
  useEffect(() => {
    if (!open || !recordedBlob || autoOpenedSound.current) return;
    autoOpenedSound.current = true;
    setSoundPickerOpen(true);
  }, [open, recordedBlob]);

  useEffect(() => {
    if (!open || recordedBlob) return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setCameraState("unsupported");
      return;
    }

    let cancelled = false;
    setCameraState("loading");

    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setCameraState("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const name = err instanceof DOMException ? err.name : "";
        setCameraState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
      });

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [open, facingMode, recordedBlob, cameraAttempt]);

  useEffect(() => {
    if (!recordedBlob) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(recordedBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [recordedBlob]);

  useEffect(() => {
    if (!recording) return;
    const id = window.setInterval(() => {
      const seconds = Math.min(MAX_SECONDS, Math.floor((Date.now() - startedAtRef.current) / 1000));
      setElapsed(seconds);
      if (seconds >= MAX_SECONDS) stopRecording();
    }, 200);
    return () => window.clearInterval(id);
  }, [recording]);

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || cameraState !== "ready") return;

    const mimeType = pickMimeType();
    let recordStream: MediaStream = stream;
    const videoEl = videoRef.current;
    const canvas = document.createElement("canvas");
    if (
      (filterId !== "none" || animal) &&
      videoEl &&
      videoEl.videoWidth &&
      canBakeFilters() &&
      typeof canvas.captureStream === "function"
    ) {
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.filter = filter.css;
        const draw = () => {
          ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
          drawAnimal(ctx, animal, faceRef.current);
          drawRef.current = requestAnimationFrame(draw);
        };
        draw();
        recordStream = new MediaStream([
          ...canvas.captureStream(30).getVideoTracks(),
          ...stream.getAudioTracks(),
        ]);
      }
    }
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(recordStream, { mimeType })
        : new MediaRecorder(recordStream);
    } catch {
      cancelAnimationFrame(drawRef.current);
      toast.error("Recording isn't supported on this device");
      return;
    }

    const chunks: Blob[] = [];
    discardRef.current = false;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = () => {
      recorderRef.current = null;
      cancelAnimationFrame(drawRef.current);
      setRecording(false);
      if (discardRef.current || chunks.length === 0) return;
      setRecordedBlob(new Blob(chunks, { type: recorder.mimeType || mimeType || "video/webm" }));
    };

    recorderRef.current = recorder;
    startedAtRef.current = Date.now();
    setElapsed(0);
    recorder.start(250);
    setRecording(true);
  }

  function stopRecording() {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function reset() {
    discardRef.current = true;
    stopRecording();
    setRecording(false);
    setRecordedBlob(null);
    setElapsed(0);
    setCaption("");
    setPosting(false);
    setFilterId("none");
    setAnimalId("");
    setChosenSound(sound ?? null);
    setSoundPickerOpen(false);
    autoOpenedSound.current = false;
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      if (posting) return;
      reset();
    }
    onOpenChange(next);
  }

  function retake() {
    setRecordedBlob(null);
    setElapsed(0);
    autoOpenedSound.current = false;
  }

  async function post() {
    if (!recordedBlob) return;
    if (!username) {
      toast.error("Finish setting up your profile before posting");
      return;
    }
    setPosting(true);
    try {
      await uploadRecording(
        recordedBlob,
        username,
        caption.trim().slice(0, 500),
        chosenSound?.id ?? null,
      );
      toast.success("Your video is posted!");
      reset();
      onOpenChange(false);
      onPosted?.();
    } catch {
      toast.error("Upload failed. Try again.");
      setPosting(false);
    }
  }

  const showCamera = !recordedBlob;
  const progress = (elapsed / MAX_SECONDS) * 100;

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="block h-[100dvh] w-screen max-w-none gap-0 overflow-hidden border-0 bg-black p-0 text-white sm:aspect-[9/16] sm:h-[min(100dvh,56rem)] sm:w-auto sm:rounded-2xl [&>button:last-child]:hidden">
          <DialogTitle className="sr-only">Record a video</DialogTitle>
          <DialogDescription className="sr-only">
            Record up to {MAX_SECONDS} seconds, then preview and post it to your feed.
          </DialogDescription>

          <div className="relative h-full w-full bg-black">
            {showCamera && (
              <AnimalOverlay
                animal={animal}
                videoRef={videoRef}
                faceRef={faceRef}
                mirror={facingMode === "user"}
              />
            )}
            {showCamera ? (
              <video
                ref={videoRef}
                autoPlay
                muted
                playsInline
                style={{ filter: filter.css }}
                className={`h-full w-full object-cover ${facingMode === "user" ? "-scale-x-100" : ""} ${
                  cameraState === "ready" ? "opacity-100" : "opacity-0"
                }`}
              />
            ) : (
              previewUrl && (
                <video
                  key={previewUrl}
                  src={previewUrl}
                  autoPlay
                  loop
                  playsInline
                  className="h-full w-full object-cover"
                />
              )
            )}

            {showCamera && cameraState !== "ready" && (
              <CameraMessage state={cameraState} onRetry={() => setCameraAttempt((n) => n + 1)} />
            )}

            {recording && (
              <div className="absolute inset-x-0 top-0 h-1 bg-white/20">
                <div
                  className="h-full bg-red-500 transition-[width] duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/60 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                aria-label="Close"
                disabled={posting}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 disabled:opacity-50"
              >
                <X className="h-6 w-6" />
              </button>

              {showCamera && (
                <div
                  className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold tabular-nums ${
                    recording ? "bg-red-500" : "bg-black/40"
                  }`}
                  aria-live="polite"
                >
                  {recording && <span className="h-2 w-2 animate-pulse rounded-full bg-white" />}
                  {formatTime(elapsed)} / {formatTime(MAX_SECONDS)}
                </div>
              )}

              {showCamera ? (
                <button
                  type="button"
                  onClick={() => setFacingMode((m) => (m === "user" ? "environment" : "user"))}
                  aria-label={
                    facingMode === "user" ? "Switch to back camera" : "Switch to front camera"
                  }
                  disabled={recording || cameraState === "loading"}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40 disabled:opacity-40"
                >
                  <RefreshCw className="h-5 w-5" />
                </button>
              ) : (
                <span className="h-10 w-10" />
              )}
            </div>

            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-12">
              {showCamera ? (
                <>
                  {!canBakeFilters() && (filterId !== "none" || !!animal) && (
                    <p className="pb-2 text-center text-xs text-white/70">
                      Filters can't be saved on this browser, so the video will post unfiltered.
                    </p>
                  )}
                  <FilterBar
                    value={filterId}
                    onChange={setFilterId}
                    disabled={recording}
                    animal={animalId}
                    onAnimalChange={setAnimalId}
                  />
                  <div className="grid grid-cols-3 items-center">
                    <div className="flex justify-start">
                      {onUploadInstead && !recording && (
                        <button
                          type="button"
                          onClick={() => {
                            reset();
                            onOpenChange(false);
                            onUploadInstead();
                          }}
                          className="flex flex-col items-center gap-1 text-xs font-semibold"
                        >
                          <span className="flex h-10 w-10 items-center justify-center rounded-lg border-2 border-white/80">
                            <Upload className="h-5 w-5" />
                          </span>
                          Upload
                        </button>
                      )}
                    </div>
                    <div className="flex justify-center">
                      <button
                        type="button"
                        onClick={recording ? stopRecording : startRecording}
                        disabled={cameraState !== "ready"}
                        aria-label={recording ? "Stop recording" : "Start recording"}
                        aria-pressed={recording}
                        className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white transition disabled:opacity-40"
                      >
                        <span
                          className={`bg-red-500 transition-all duration-200 ${
                            recording ? "h-8 w-8 rounded-md" : "h-16 w-16 rounded-full"
                          }`}
                        />
                      </button>
                    </div>
                    <div />
                  </div>
                </>
              ) : (
                <div className="flex flex-col gap-3">
                  <button
                    type="button"
                    onClick={() => setSoundPickerOpen(true)}
                    disabled={posting}
                    className="flex max-w-full items-center gap-2 self-start rounded-full bg-white/15 px-3 py-2 text-left text-xs font-semibold text-white transition hover:bg-white/25 disabled:opacity-50"
                  >
                    <Music className="h-4 w-4 shrink-0" />
                    <span className="min-w-0 truncate">
                      {chosenSound ? chosenSound.title : "Original sound"}
                    </span>
                    <span className="shrink-0 text-white/60">· Change</span>
                  </button>
                  <label className="sr-only" htmlFor="record-caption">
                    Caption
                  </label>
                  <input
                    id="record-caption"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    maxLength={500}
                    placeholder="Add a caption… #hashtags"
                    className="w-full rounded-full bg-white/15 px-4 py-3 text-base text-white outline-none placeholder:text-white/60 focus:ring-2 focus:ring-white/70"
                  />
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={retake}
                      disabled={posting}
                      className="flex items-center justify-center gap-2 rounded-full border border-white/70 py-3 font-bold disabled:opacity-50"
                    >
                      <RotateCcw className="h-5 w-5" /> Retake
                    </button>
                    <button
                      type="button"
                      onClick={post}
                      disabled={posting}
                      className="flex items-center justify-center gap-2 rounded-full bg-white py-3 font-bold text-black disabled:opacity-60"
                    >
                      {posting ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <Send className="h-5 w-5" />
                      )}
                      {posting ? "Posting…" : "Post"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <SoundPickerDialog
        open={soundPickerOpen}
        onOpenChange={setSoundPickerOpen}
        selectedSound={chosenSound}
        onSelect={setChosenSound}
        originalLabel={username ? `Original sound - @${username}` : "Your voice"}
      />
    </>
  );
}

const CAMERA_MESSAGES: Record<
  Exclude<CameraState, "loading" | "ready">,
  { title: string; body: string }
> = {
  denied: {
    title: "Allow camera access",
    body: "Coolerup needs your camera and microphone to record. Enable them in your browser or app settings, then try again.",
  },
  unsupported: {
    title: "Recording not supported",
    body: "This browser can't record video. Try a recent version of Chrome, Safari, or Firefox.",
  },
  error: {
    title: "Camera unavailable",
    body: "We couldn't start your camera. Make sure no other app is using it and try again.",
  },
};

function CameraMessage({ state, onRetry }: { state: CameraState; onRetry: () => void }) {
  if (state === "loading" || state === "ready") {
    return (
      <div className="absolute inset-0 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-white/70" aria-label="Starting camera" />
      </div>
    );
  }

  const copy = CAMERA_MESSAGES[state];

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-8 text-center">
      <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10">
        <Camera className="h-8 w-8" />
      </span>
      <h3 className="text-xl font-bold">{copy.title}</h3>
      <p className="text-sm text-white/70">{copy.body}</p>
      {state !== "unsupported" && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full bg-white px-6 py-2.5 font-bold text-black"
        >
          Try again
        </button>
      )}
    </div>
  );
}
