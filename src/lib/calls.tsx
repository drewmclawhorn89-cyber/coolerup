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

export type CallState =
  | { status: "idle" }
  | { status: "outgoing"; peer: string; peerId: string }
  | { status: "incoming"; peer: string; peerId: string }
  | { status: "active"; peer: string; peerId: string; startedAt: number };

type Signal =
  | { kind: "offer"; from: string; fromId: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; sdp: RTCSessionDescriptionInit }
  | { kind: "ice"; from: string; candidate: RTCIceCandidateInit }
  | { kind: "end"; from: string }
  | { kind: "decline"; from: string };

type CallContextValue = {
  call: CallState;
  muted: boolean;
  startCall: (peerUsername: string, peerId: string) => Promise<void>;
  acceptCall: () => Promise<void>;
  declineCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
};

const CallContext = createContext<CallContextValue | null>(null);

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }],
};

const RING_TIMEOUT_MS = 30_000;

export function CallProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [call, setCall] = useState<CallState>({ status: "idle" });
  const [muted, setMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingIceRef = useRef<RTCIceCandidateInit[]>([]);
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Ref mirror of call state so channel callbacks always see the latest.
  const callRef = useRef<CallState>(call);
  callRef.current = call;

  const cleanup = useCallback(() => {
    if (ringTimerRef.current) {
      clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
    }
    pcRef.current?.close();
    pcRef.current = null;
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
      remoteAudioRef.current.remove();
      remoteAudioRef.current = null;
    }
    pendingIceRef.current = [];
    setMuted(false);
    setCall({ status: "idle" });
  }, []);

  const sendSignal = useCallback((peerId: string, signal: Signal) => {
    const ch = supabase.channel(`loop-call-${peerId}`);
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        void ch.send({ type: "broadcast", event: "call", payload: signal }).then(() => {
          void supabase.removeChannel(ch);
        });
      }
    });
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, peerUsername: string) => {
      const pc = new RTCPeerConnection(RTC_CONFIG);
      pcRef.current = pc;

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendSignal(peerId, { kind: "ice", from: auth.handle ?? "", candidate: e.candidate.toJSON() });
        }
      };
      pc.ontrack = (e) => {
        if (!remoteAudioRef.current) {
          const audio = document.createElement("audio");
          audio.autoplay = true;
          remoteAudioRef.current = audio;
        }
        remoteAudioRef.current.srcObject = e.streams[0];
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setCall((c) =>
            c.status === "outgoing" || c.status === "incoming"
              ? { status: "active", peer: peerUsername, peerId, startedAt: Date.now() }
              : c,
          );
        }
        if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
          toast.error("Call connection lost");
          cleanup();
        }
      };
      return pc;
    },
    [auth.handle, sendSignal, cleanup],
  );

  const getMic = async () => {
    if (!localStreamRef.current) {
      localStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    }
    return localStreamRef.current;
  };

  const startCall = useCallback(
    async (peerUsername: string, peerId: string) => {
      if (!auth.user || !auth.handle) {
        void auth.signIn();
        return;
      }
      if (callRef.current.status !== "idle") return;
      try {
        const stream = await getMic();
        const pc = createPeerConnection(peerId, peerUsername);
        stream.getTracks().forEach((t) => pc.addTrack(t, stream));
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        setCall({ status: "outgoing", peer: peerUsername, peerId });
        sendSignal(peerId, { kind: "offer", from: auth.handle, fromId: auth.user.id, sdp: offer });
        ringTimerRef.current = setTimeout(() => {
          if (callRef.current.status === "outgoing") {
            toast.message(`@${peerUsername} didn't answer`);
            sendSignal(peerId, { kind: "end", from: auth.handle ?? "" });
            cleanup();
          }
        }, RING_TIMEOUT_MS);
      } catch {
        toast.error("Couldn't access your microphone");
        cleanup();
      }
    },
    [auth, createPeerConnection, sendSignal, cleanup],
  );

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (c.status !== "incoming" || !auth.handle) return;
    try {
      const stream = await getMic();
      const pc = pcRef.current ?? createPeerConnection(c.peerId, c.peer);
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      // The offer was applied when the call arrived; create the answer now.
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      for (const candidate of pendingIceRef.current) {
        await pc.addIceCandidate(candidate).catch(() => {});
      }
      pendingIceRef.current = [];
      sendSignal(c.peerId, { kind: "answer", from: auth.handle, sdp: answer });
      setCall({ status: "active", peer: c.peer, peerId: c.peerId, startedAt: Date.now() });
    } catch {
      toast.error("Couldn't access your microphone");
      sendSignal(c.peerId, { kind: "decline", from: auth.handle });
      cleanup();
    }
  }, [auth.handle, createPeerConnection, sendSignal, cleanup]);

  const declineCall = useCallback(() => {
    const c = callRef.current;
    if (c.status === "incoming" && auth.handle) {
      sendSignal(c.peerId, { kind: "decline", from: auth.handle });
    }
    cleanup();
  }, [auth.handle, sendSignal, cleanup]);

  const endCall = useCallback(() => {
    const c = callRef.current;
    if ((c.status === "active" || c.status === "outgoing") && auth.handle) {
      sendSignal(c.peerId, { kind: "end", from: auth.handle });
    }
    cleanup();
  }, [auth.handle, sendSignal, cleanup]);

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
            sendSignal(payload.fromId, { kind: "decline", from: myHandle });
            return;
          }
          const pc = createPeerConnection(payload.fromId, payload.from);
          await pc.setRemoteDescription(payload.sdp).catch(() => {});
          setCall({ status: "incoming", peer: payload.from, peerId: payload.fromId });
          ringTimerRef.current = setTimeout(() => {
            if (callRef.current.status === "incoming") cleanup();
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
            await pc.setRemoteDescription(payload.sdp).catch(() => {});
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
  }, [auth.user?.id, auth.handle, createPeerConnection, sendSignal, cleanup]);

  // Hang up if the tab closes mid-call.
  useEffect(() => {
    const onUnload = () => {
      const c = callRef.current;
      if (c.status === "active" || c.status === "outgoing") {
        sendSignal(c.peerId, { kind: "end", from: auth.handle ?? "" });
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [auth.handle, sendSignal]);

  return (
    <CallContext.Provider value={{ call, muted, startCall, acceptCall, declineCall, endCall, toggleMute }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error("useCall must be used inside CallProvider");
  return ctx;
}
