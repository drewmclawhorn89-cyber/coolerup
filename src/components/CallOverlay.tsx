import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, Video, VideoOff } from "lucide-react";
import { useCall } from "@/lib/calls";
import { Button } from "@/components/ui/button";

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CallOverlay() {
  const {
    call,
    muted,
    video,
    cameraOff,
    localStream,
    remoteStream,
    acceptCall,
    declineCall,
    endCall,
    toggleMute,
    toggleCamera,
  } = useCall();
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const el = localRef.current;
    if (el) {
      el.srcObject = localStream;
      void el.play().catch(() => {});
    }
  }, [localStream, call.status, video]);
  useEffect(() => {
    const el = remoteRef.current;
    if (el) {
      el.srcObject = remoteStream;
      void el.play().catch(() => {});
    }
  }, [remoteStream, call.status, video]);
  // Remote audio lives in a real, mounted element. A detached <audio> (the old
  // approach) is silently ignored by iOS Safari, which made calls sound dead.
  useEffect(() => {
    const el = audioRef.current;
    if (el) {
      el.srcObject = remoteStream;
      void el.play().catch(() => {});
    }
  }, [remoteStream, call.status]);
  const [, tick] = useState(0);

  // 1s tick for the call timer.
  useEffect(() => {
    if (call.status !== "active") return;
    const id = setInterval(() => tick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, [call.status]);

  if (call.status === "idle") return null;

  const initial = call.peer[0]?.toUpperCase() ?? "?";

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex h-[100dvh] flex-col items-center justify-center gap-6 bg-background/95 px-6 pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] backdrop-blur">
      <audio
        ref={audioRef}
        autoPlay
        playsInline
        className="pointer-events-none absolute h-px w-px opacity-0"
        aria-hidden="true"
      />
      {video && (
        <>
          {/* Remote video fills the screen; audio is played separately by the call provider. */}
          <video
            ref={remoteRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 h-full w-full bg-black object-cover"
          />
          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className={`absolute right-4 top-[calc(env(safe-area-inset-top)+1rem)] h-40 w-28 -scale-x-100 rounded-xl border bg-black object-cover shadow-lg ${cameraOff ? "opacity-0" : ""}`}
          />
        </>
      )}
      <div
        className={`relative flex h-24 w-24 items-center justify-center rounded-full bg-primary font-display text-4xl uppercase text-primary-foreground ${video && call.status === "active" ? "hidden" : ""}`}
      >
        {initial}
      </div>
      <div className="relative text-center">
        <p className="font-display text-2xl">@{call.peer}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {call.status === "outgoing" && (video ? "Video calling…" : "Calling…")}
          {call.status === "incoming" && (video ? "Incoming video call" : "Incoming voice call")}
          {call.status === "active" && formatDuration(Date.now() - call.startedAt)}
        </p>
      </div>

      <div
        className={`relative flex items-center gap-4 ${video && call.status === "active" ? "absolute bottom-[calc(env(safe-area-inset-bottom)+2rem)]" : ""}`}
      >
        {call.status === "incoming" && (
          <>
            <Button
              size="icon"
              variant="destructive"
              className="h-14 w-14 rounded-full"
              onClick={declineCall}
              aria-label="Decline call"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
            <Button
              size="icon"
              className="h-14 w-14 rounded-full bg-green-600 text-white hover:bg-green-500"
              onClick={acceptCall}
              aria-label="Answer call"
            >
              <Phone className="h-6 w-6" />
            </Button>
          </>
        )}

        {call.status === "outgoing" && (
          <Button
            size="icon"
            variant="destructive"
            className="h-14 w-14 rounded-full"
            onClick={endCall}
            aria-label="Cancel call"
          >
            <PhoneOff className="h-6 w-6" />
          </Button>
        )}

        {call.status === "active" && (
          <>
            <Button
              size="icon"
              variant={muted ? "default" : "secondary"}
              className="h-14 w-14 rounded-full"
              onClick={toggleMute}
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
            </Button>
            {video && (
              <Button
                size="icon"
                variant={cameraOff ? "default" : "secondary"}
                className="h-14 w-14 rounded-full"
                onClick={toggleCamera}
                aria-label={cameraOff ? "Turn camera on" : "Turn camera off"}
              >
                {cameraOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
              </Button>
            )}
            <Button
              size="icon"
              variant="destructive"
              className="h-14 w-14 rounded-full"
              onClick={endCall}
              aria-label="End call"
            >
              <PhoneOff className="h-6 w-6" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
