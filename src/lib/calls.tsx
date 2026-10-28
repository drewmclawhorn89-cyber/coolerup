import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { sendCallPush } from "@/lib/push.functions";
import { ensurePushSubscription } from "@/lib/push-client";

export type CallState =
  | { status: "idle" }
  | { status: "outgoing"; peer: string; peerId: string }
  | { status: "incoming"; peer: string; peerId: string }
  | { status: "active"; peer: string; peerId: string; startedAt: number };

type Signal =
  | { kind: "offer"; from: string; fromId: string; video?: boolean; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; candidate: RTCIceCandidateInit }
  | { kind: "end"; from: string }
  | { kind: "decline"; from: string };

type CallContextValue = {
  call: CallState;
  muted: boolean;
  video: boolean;
  cameraOff: boolean;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  startCall: (peerUsername: string, peerId: string, withVideo?: boolean) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
    // TURN relay so media still flows across strict NATs / cellular networks.
    {
      urls: [
        "turn:openrelay.metered.ca:80",
        "turn:openrelay.metered.ca:443",
        "turn:openrelay.metered.ca:443?transport=tcp",
      ],
      username: "openrelayproject",
      credential: "openrelayproject",
    },
  ],
};

function formatCallDuration(ms: number) {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

const RING_TIMEOUT_MS = 30_000;

export function CallProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [call, setCall] = useState<CallState>({ status: "idle" });
  const [muted, setMuted] = useState(false);
  const [video, setVideo] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const videoRef = useRef(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startingRef = useRef(false);
  // ICE gathering starts as soon as the local description is set, which can be
  // before the offer finishes sending. Hold candidates until the offer is out.
  const offerGateRef = useRef<Promise<void> | null>(null);
  const releaseOfferGateRef = useRef<(() => void) | null>(null);
  // One persistent signalling channel per peer. See sendSignal() for why.
  const signalBusRef = useRef(
    new Map<string, { channel: ReturnType<typeof supabase.channel>; ready: Promise<void> }>(),
  );
  // Ref mirror of call state so channel callbacks always see the latest.
  const callRef = useRef<CallState>(call);
  callRef.current = call;

  /**
   * Signals (offer / answer / ICE / end) travel over Supabase Realtime broadcast.
   *
   * The original implementation opened a brand-new channel for every single
   * signal, sent, then immediately removed the channel. That tears the socket
   * down before the queued broadcast flushes: in a burst of 8 signals only 1
   * arrived, so the offer would land but the answer and every ICE candidate were
   * dropped and the media path never formed.
   *
   * Instead we keep one channel per peer alive for the duration of the call and
   * only send once the channel reports SUBSCRIBED.
   */
  const sendSignal = useCallback(async (peerId: string, signal: Signal) => {
    const bus = signalBusRef.current;
    let entry = bus.get(peerId);
    if (!entry) {
      const channel = supabase.channel(`loop-call-${peerId}`);
      const ready = new Promise<void>((resolve) => {
        channel.subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          // A dead channel must never be reused, or every later send hangs.
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            if (bus.get(peerId)?.channel === channel) bus.delete(peerId);
          }
        });
      });
      entry = { channel, ready };
      bus.set(peerId, entry);
    }
    try {
      await entry.ready;
      await entry.channel.send({ type: "broadcast", event: "call", payload: signal });
    } catch {
      // A dropped signal must not break the call flow.
    }
  }, []);

  const teardownSignalBus = useCallback(() => {
    const bus = signalBusRef.current;
    for (const { channel } of bus.values()) void supabase.removeChannel(channel);
    bus.clear();
  }, []);

  const cleanup = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    if (disconnectTimerRef.current) {
      clearTimeout(disconnectTimerRef.current);
      disconnectTimerRef.current = null;
    }
    startingRef.current = false;
    // Never leave ICE sends waiting on an offer that will not be sent.
    releaseOfferGateRef.current?.();
    releaseOfferGateRef.current = null;
    offerGateRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    pendingIceRef.current = [];
    videoRef.current = false;
    setVideo(false);
    setCameraOff(false);
    setLocalStream(null);
    setRemoteStream(null);
    setMuted(false);
    setCall({ status: "idle" });
    teardownSignalBus();
  }, [teardownSignalBus]);

  // Record call outcomes in the chat thread (caller side only, to avoid duplicates).
  const logCall = useCallback(
    (c: CallState, text: string) => {
      if (c.status === "idle" || !auth.user || !auth.handle) return;
      void supabase.from("direct_messages").insert({
        from_id: auth.user.id,
        to_id: c.peerId,
        from_username: auth.handle,
        to_username: c.peer,
        message: text,
      });
    },
    [auth.user, auth.handle],
  );

  const createPeerConnection = useCallback(
    (peerId: string, peerUsername: string) => {
      // Never leave a stale connection behind.
      pcRef.current?.close();
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (!e.candidate) return;
        const candidate = e.candidate.toJSON();
        void (async () => {
          if (offerGateRef.current) await offerGateRef.current;
          await sendSignal(peerId, { kind: "ice", from: auth.handle ?? "", candidate });
        })();
      };
      const remote = new MediaStream();
      pc.ontrack = (e) => {
        if (!remote.getTracks().includes(e.track)) remote.addTrack(e.track);
        setRemoteStream(remote);
      };
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        if (state === "connected") {
          if (disconnectTimerRef.current) {
            clearTimeout(disconnectTimerRef.current);
            disconnectTimerRef.current = null;
          }
          setCall((c) =>
            c.status === "outgoing" || c.status === "incoming"
              ? { status: "active", peer: peerUsername, peerId, startedAt: Date.now() }
              : c,
          );
        }
        if (state === "failed") {
          toast.error("Call connection lost");
          cleanup();
        }
        if (state === "disconnected") {
          // "disconnected" is usually a transient network blip that ICE recovers
          // from. Only hang up if it doesn't come back.
          if (disconnectTimerRef.current) clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = setTimeout(() => {
            if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
              toast.error("Call connection lost");
              cleanup();
            }
          }, 8000);
        }
      };
      return pc;
    },
    [auth.handle, sendSignal, cleanup],
  );

  const getMic = async () => {
    if (!localStreamRef.current) {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: videoRef.current ? { facingMode: "user" } : false,
      });
      setLocalStream(localStreamRef.current);
    }
    return localStreamRef.current;
  };

  const startCall = useCallback(
    async (peerUsername: string, peerId: string, withVideo = false) => {
      if (!auth.user || !auth.handle) {
        void auth.signIn();
        return;
      }
      if (callRef.current.status !== "idle" || startingRef.current) return;
      startingRef.current = true;
      videoRef.current = withVideo;
      setVideo(withVideo);
      // Paint the calling screen immediately — the mic/camera permission prompt
      // can take seconds, and before this the user saw nothing at all.
      setCall({ status: "outgoing", peer: peerUsername, peerId });
      try {
        const stream = await getMic();
        const pc = createPeerConnection(peerId, peerUsername);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        offerGateRef.current = new Promise<void>((resolve) => {
          releaseOfferGateRef.current = resolve;
        });
        await pc.setLocalDescription(offer);
        // Wake the callee's installed app / background tab.
        void sendCallPush({ data: { peerId } }).catch(() => {});
        await sendSignal(peerId, {
          kind: "offer",
          from: auth.handle,
          fromId: auth.user.id,
          video: withVideo,
          sdp: offer,
        });
        // Offer is out — let the buffered ICE candidates through.
        releaseOfferGateRef.current?.();
        releaseOfferGateRef.current = null;
        offerGateRef.current = null;
        ringTimerRef.current = setTimeout(() => {
          if (callRef.current.status === "outgoing") {
            toast.message(`@${peerUsername} didn't answer`);
            logCall(callRef.current, "📞 Missed call");
            void sendSignal(peerId, { kind: "end", from: auth.handle ?? "" }).finally(cleanup);
          }
        }, RING_TIMEOUT_MS);
      } catch {
        toast.error("Couldn't access your microphone or camera");
        cleanup();
      }
    },
    [auth, createPeerConnection, sendSignal, cleanup, logCall],
  );

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (c.status !== "incoming" || !auth.handle) return;
    try {
      const stream = await getMic();
      const existing = pcRef.current;
      const pc =
        existing && existing.signalingState !== "closed"
          ? existing
          : createPeerConnection(c.peerId, c.peer);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      // The offer was applied when the call arrived; create the answer now.
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      for (const candidate of pendingIceRef.current) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
      pendingIceRef.current = [];
      await sendSignal(c.peerId, { kind: "answer", from: auth.handle, sdp: answer });
      setCall({ status: "active", peer: c.peer, peerId: c.peerId, startedAt: Date.now() });
    } catch {
      toast.error("Couldn't access your microphone or camera");
      void sendSignal(c.peerId, { kind: "decline", from: auth.handle }).finally(cleanup);
    }
  }, [auth.handle, createPeerConnection, sendSignal, cleanup]);

  const declineCall = useCallback(() => {
    const c = callRef.current;
    if (c.status === "incoming" && auth.handle) {
      // Wait for the decline to flush before closing the channel.
      void sendSignal(c.peerId, { kind: "decline", from: auth.handle }).finally(cleanup);
      return;
    }
    cleanup();
  }, [auth.handle, sendSignal, cleanup]);

  const endCall = useCallback(() => {
    const c = callRef.current;
    if ((c.status === "active" || c.status === "outgoing") && auth.handle) {
      if (c.status === "outgoing") logCall(c, "📞 Missed call");
      else logCall(c, `📞 Call ended · ${formatCallDuration(Date.now() - c.startedAt)}`);
      // Let the hangup reach the other side before we close the channel.
      void sendSignal(c.peerId, { kind: "end", from: auth.handle }).finally(cleanup);
      return;
    }
    cleanup();
  }, [auth.handle, sendSignal, cleanup, logCall]);

  const toggleCamera = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !cameraOff;
    stream.getVideoTracks().forEach((t) => (t.enabled = !next));
    setCameraOff(next);
  }, [cameraOff]);

  const toggleMute = useCallback(() => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const next = !muted;
    stream.getAudioTracks().forEach((t) => (t.enabled = !next));
    setMuted(next);
  }, [muted]);

  // Listen for incoming call signals on my own channel.
  useEffect(() => {
    if (!auth.user || !auth.handle) return;
    const myId = auth.user.id;
    const myHandle = auth.handle;
    const ch = supabase.channel(`loop-call-${myId}`);

    ch.on("broadcast", { event: "call" }, async ({ payload }: { payload: Signal }) => {
      const c = callRef.current;
      switch (payload.kind) {
        case "offer": {
          if (c.status !== "idle") {
            // Busy — tell the caller.
            void sendSignal(payload.fromId, { kind: "decline", from: myHandle });
            return;
          }
          videoRef.current = payload.video === true;
          setVideo(payload.video === true);
          const pc = createPeerConnection(payload.fromId, payload.from);
          try {
            await pc.setRemoteDescription(payload.sdp);
          } catch {
            toast.error("Couldn't receive that call");
            void sendSignal(payload.fromId, { kind: "decline", from: myHandle });
            cleanup();
            return;
          }
          setCall({ status: "incoming", peer: payload.from, peerId: payload.fromId });
          if (document.hidden) {
            navigator.vibrate?.([300, 150, 300, 150, 300]);
            if ("Notification" in window && Notification.permission === "granted") {
              new Notification(
                `Incoming ${payload.video ? "video " : ""}call from @${payload.from}`,
                { tag: "loop-call", requireInteraction: true },
              );
            }
          }
          ringTimerRef.current = setTimeout(() => {
            if (callRef.current.status === "incoming") {
              // Tell the caller we never picked up instead of leaving them ringing.
              void sendSignal(payload.fromId, { kind: "end", from: myHandle }).finally(cleanup);
            }
          }, RING_TIMEOUT_MS);
          break;
        }
        case "answer": {
          if (c.status !== "outgoing") return;
          if (ringTimerRef.current) {
            clearTimeout(ringTimerRef.current);
            ringTimerRef.current = null;
          }
          const pc = pcRef.current;
          if (pc) {
            await pc.setRemoteDescription(payload.sdp).catch(() => {
              toast.error("Couldn't connect that call");
              cleanup();
            });
            for (const candidate of pendingIceRef.current) {
              await pc.addIceCandidate(candidate).catch(() => {});
            }
            pendingIceRef.current = [];
          }
          break;
        }
        case "ice": {
          const pc = pcRef.current;
          if (pc?.remoteDescription) {
            await pc.addIceCandidate(payload.candidate).catch(() => {});
          } else {
            pendingIceRef.current.push(payload.candidate);
          }
          break;
        }
        case "end": {
          if (c.status !== "idle") {
            toast.message("Call ended");
            cleanup();
          }
          break;
        }
        case "decline": {
          if (c.status === "outgoing") {
            toast.message(`@${c.peer} declined the call`);
            logCall(c, "📞 Declined call");
            cleanup();
          }
          break;
        }
      }
    });

    ch.subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [auth.user?.id, auth.handle, createPeerConnection, sendSignal, cleanup, logCall]);

  // Register this device for Web Push so calls ring even when the app is closed.
  // (Likes, comments, follows and DMs are handled by the global PushRegistrar.)
  useEffect(() => {
    if (!auth.user) return;
    void ensurePushSubscription();
  }, [auth.user?.id]);

  // Hang up if the tab closes mid-call.
  useEffect(() => {
    const onUnload = () => {
      const c = callRef.current;
      if (c.status === "active" || c.status === "outgoing") {
        void sendSignal(c.peerId, { kind: "end", from: auth.handle ?? "" });
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [auth.handle, sendSignal]);

  return (
    <CallContext.Provider
      value={{
        call,
        muted,
        video,
        cameraOff,
        localStream,
        remoteStream,
        startCall,
        acceptCall,
        declineCall,
        endCall,
        toggleMute,
        toggleCamera,
      }}
    >
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside CallProvider");
  return ctx;
}
