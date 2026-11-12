import { useEffect, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff } from "lucide-react";
import { useCall } from "@/lib/calls";
import { Button } from "@/components/ui/button";

function formatDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function CallOverlay() {
  const { call, muted, acceptCall, declineCall, endCall, toggleMute } = useCall();
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
    <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-6 bg-background/95 px-6 backdrop-blur">
      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary font-display text-4xl uppercase text-primary-foreground">
        {initial}
      </div>
      <div className="text-center">
        <p className="font-display text-2xl">@{call.peer}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {call.status === "outgoing" && "Calling…"}
          {call.status === "incoming" && "Incoming voice call"}
          {call.status === "active" && formatDuration(Date.now() - call.startedAt)}
        </p>
      </div>

      <div className="flex items-center gap-4">
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
