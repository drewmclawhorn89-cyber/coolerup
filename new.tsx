import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, RefreshCw, X } from "lucide-react";

const MAX_SECONDS = 60;

type Facing = "user" | "environment";

interface RecordDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPosted?: () => void;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4", // iOS Safari
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function RecordDialog({ open, onOpenChange, onPosted }: RecordDialogProps) {
  const liveVideoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const startedAtRef = useRef<number>(0);

  const [facing, setFacing] = useState<Facing>("user");
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState<string | null>(null);

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (liveVideoRef.current) liveVideoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(
    async (mode: Facing) => {
      setPermissionDenied(false);
      setCameraError(null);
      stopStream();

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera is not supported on this device or browser.");
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: mode },
          audio: true,
        });
        streamRef.current = stream;
        if (liveVideoRef.current) {
          liveVideoRef.current.srcObject = stream;
          liveVideoRef.current.play().catch(() => {});
        }
      } catch (err) {
        const name = (err as DOMException)?.name;
        if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
          setPermissionDenied(true);
        } else if (name === "NotFoundError") {
          setCameraError("No camera found on this device.");
        } else {
          setCameraError("Could not start the camera.");
        }
      }
    },
    [stopStream],
  );

  const resetAll = useCallback(() => {
    clearTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.onstop = null;
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopStream();
    setRecording(false);
    setElapsed(0);
    setRecordedBlob(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setPostError(null);
    setPosting(false);
  }, [stopStream]);

  // Open / close lifecycle
  useEffect(() => {
    if (open) {
      void startCamera(facing);
    } else {
      resetAll();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Release camera on unmount
  useEffect(() => () => resetAll(), [resetAll]);

  // Re-attach stream when returning from preview (video element remounts)
  useEffect(() => {
    if (open && !recordedBlob && streamRef.current && liveVideoRef.current) {
      liveVideoRef.current.srcObject = streamRef.current;
      liveVideoRef.current.play().catch(() => {});
    }
  }, [open, recordedBlob]);

  const stopRecording = useCallback(() => {
    clearTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
    setRecording(false);
  }, []);

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === "undefined") {
      setCameraError("Recording is not supported on this device.");
      return;
    }

    chunksRef.current = [];
    const mimeType = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    } catch {
      setCameraError("Could not start recording.");
      return;
    }

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || "video/webm";
      const blob = new Blob(chunksRef.current, { type });
      setRecordedBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      stopStream(); // free the camera while previewing
    };

    recorderRef.current = rec;
    rec.start(250);
    startedAtRef.current = Date.now();
    setElapsed(0);
    setRecording(true);

    timerRef.current = window.setInterval(() => {
      const secs = Math.floor((Date.now() - startedAtRef.current) / 1000);
      setElapsed(Math.min(secs, MAX_SECONDS));
      if (secs >= MAX_SECONDS) stopRecording();
    }, 200);
  }, [stopRecording, stopStream]);

  const toggleRecording = () => (recording ? stopRecording() : startRecording());

  const flipCamera = () => {
    if (recording) return;
    const next: Facing = facing === "user" ? "environment" : "user";
    setFacing(next);
    void startCamera(next);
  };

  const retake = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRecordedBlob(null);
    setElapsed(0);
    setPostError(null);
    void startCamera(facing);
  };

  const post = async () => {
    if (!recordedBlob) return;
    setPosting(true);
    setPostError(null);
    try {
      const { data: userData, error: userErr } = await supabase.auth.getUser();
      if (userErr || !userData.user) throw new Error("You need to be logged in to post.");

      const ext = recordedBlob.type.includes("mp4") ? "mp4" : "webm";
      const fileName = `recorded-${Date.now()}.${ext}`;
      const path = `${userData.user.id}/${fileName}`;

      const { error: uploadErr } = await supabase.storage
        .from("videos")
        .upload(path, recordedBlob, { contentType: recordedBlob.type, upsert: false });
      if (uploadErr) throw uploadErr;

      const { data: pub } = supabase.storage.from("videos").getPublicUrl(path);

      // TODO: match these column names to what UploadDialog inserts.
      const { error: insertErr } = await supabase.from("videos").insert({
        user_id: userData.user.id,
        video_url: pub.publicUrl,
        title: "",
      } as never);
      if (insertErr) throw insertErr;

      onPosted?.();
      onOpenChange(false);
    } catch (err) {
      setPostError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setPosting(false);
    }
  };

  const fmt = (s: number) => `0:${String(s).padStart(2, "0")}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !posting && onOpenChange(o)}>
      <DialogContent
        className="fixed inset-0 left-0 top-0 h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 rounded-none border-0 bg-black p-0 text-white sm:max-w-none sm:rounded-none [&>button]:hidden"
      >
        <DialogTitle className="sr-only">Record video</DialogTitle>
        <DialogDescription className="sr-only">Record a video up to 60 seconds and post it.</DialogDescription>

        <div className="relative mx-auto flex h-full w-full max-w-[min(100vw,calc(100dvh*9/16))] items-center justify-center bg-black">
          {/* Close */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={posting}
            aria-label="Close"
            className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 rounded-full bg-black/50 p-2 text-white"
          >
            <X className="h-6 w-6" />
          </button>

          {/* Permission / error states */}
          {permissionDenied && !recordedBlob && (
            <div className="flex flex-col items-center gap-4 px-8 text-center">
              <p className="text-lg font-semibold">Allow camera access</p>
              <p className="text-sm text-white/70">
                Coolerup needs camera and microphone permission to record. Enable it in your browser or app
                settings, then try again.
              </p>
              <Button variant="secondary" onClick={() => startCamera(facing)}>
                Try again
              </Button>
            </div>
          )}

          {cameraError && !permissionDenied && !recordedBlob && (
            <div className="flex flex-col items-center gap-4 px-8 text-center">
              <p className="text-sm text-white/80">{cameraError}</p>
              <Button variant="secondary" onClick={() => startCamera(facing)}>
                Retry
              </Button>
            </div>
          )}

          {/* Live camera */}
          {!recordedBlob && !permissionDenied && !cameraError && (
            <>
              <video
                ref={liveVideoRef}
                className={`h-full w-full object-cover ${facing === "user" ? "-scale-x-100" : ""}`}
                playsInline
                muted
                autoPlay
              />

              {/* Timer */}
              <div className="absolute left-1/2 top-[max(1rem,env(safe-area-inset-top))] z-10 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-sm font-medium tabular-nums">
                {recording && <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />}
                {fmt(elapsed)} / {fmt(MAX_SECONDS)}
              </div>

              {/* Flip camera */}
              <button
                type="button"
                onClick={flipCamera}
                disabled={recording}
                aria-label="Switch camera"
                className="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-20 rounded-full bg-black/50 p-2 text-white disabled:opacity-40"
              >
                <RefreshCw className="h-6 w-6" />
              </button>

              {/* Record button */}
              <div className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] z-10 flex justify-center">
                <button
                  type="button"
                  onClick={toggleRecording}
                  aria-label={recording ? "Stop recording" : "Start recording"}
                  className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-transparent"
                >
                  <span
                    className={`bg-red-600 transition-all ${recording ? "h-8 w-8 rounded-md" : "h-16 w-16 rounded-full"}`}
                  />
                </button>
              </div>
            </>
          )}

          {/* Preview after recording */}
          {recordedBlob && previewUrl && (
            <>
              <video
                key={previewUrl}
                src={previewUrl}
                className="h-full w-full object-cover"
                playsInline
                autoPlay
                loop
                controls={false}
              />
              {postError && (
                <p className="absolute inset-x-4 bottom-28 z-10 rounded bg-red-600/90 p-2 text-center text-sm">
                  {postError}
                </p>
              )}
              <div className="absolute inset-x-0 bottom-[max(2rem,env(safe-area-inset-bottom))] z-10 flex justify-center gap-4 px-6">
                <Button
                  variant="secondary"
                  size="lg"
                  className="flex-1"
                  onClick={retake}
                  disabled={posting}
                >
                  Retake
                </Button>
                <Button
                  size="lg"
                  className="flex-1 bg-red-600 text-white hover:bg-red-700"
                  onClick={post}
                  disabled={posting}
                >
                  {posting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Post"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default RecordDialog;
