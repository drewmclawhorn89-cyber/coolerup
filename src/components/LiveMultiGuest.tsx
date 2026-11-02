import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CameraOff, Mic, MicOff, PhoneOff, Shield, UserX } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { guestGridClass, guestName, type LiveGuest } from "@/lib/liveJoin";

const ICE: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

type StageSignal =
  | { kind: "hello"; from: string; to?: string; name: string }
  | { kind: "offer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: "answer"; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: "candidate"; from: string; to: string; candidate: RTCIceCandidateInit }
  | { kind: "media"; from: string; micOn: boolean; camOn: boolean }
  | { kind: "bye"; from: string };

type PeerState = {
  pc: RTCPeerConnection;
  stream: MediaStream;
  micOn: boolean;
  camOn: boolean;
};

function VideoTile({
  stream,
  label,
  isHost,
  isSelf,
  micOn,
  camOn,
  canRemove,
  onRemove,
  onToggleMic,
  onToggleCam,
  onLeave,
}: {
  stream: MediaStream | null;
  label: string;
  isHost?: boolean;
  isSelf?: boolean;
  micOn: boolean;
  camOn: boolean;
  canRemove?: boolean;
  onRemove?: () => void;
  onToggleMic?: () => void;
  onToggleCam?: () => void;
  onLeave?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf}
        className={`h-full w-full object-cover ${camOn ? "" : "opacity-0"}`}
      />
      {!camOn && (
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/10 text-sm font-extrabold text-white/70">
            {label.replace(/^@/, "").slice(0, 2).toUpperCase()}
          </div>
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/80 to-transparent p-1.5">
        {isHost && <Shield className="h-3 w-3 shrink-0 text-sky-400" />}
        <span className="min-w-0 flex-1 truncate text-[10px] font-bold text-white">
          {isSelf ? "You" : label}
        </span>
        {!micOn && <MicOff className="h-3 w-3 shrink-0 text-rose-400" />}
        {!camOn && <CameraOff className="h-3 w-3 shrink-0 text-rose-400" />}
      </div>

      {(canRemove || onToggleMic || onToggleCam || onLeave) && (
        <div className="absolute right-1 top-1 flex gap-1">
          {onToggleMic && (
            <button
              type="button"
              onClick={onToggleMic}
              aria-label={micOn ? "Mute yourself" : "Unmute yourself"}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
            >
              {micOn ? <Mic className="h-3 w-3" /> : <MicOff className="h-3 w-3 text-rose-400" />}
            </button>
          )}
          {onToggleCam && (
            <button
              type="button"
              onClick={onToggleCam}
              aria-label={camOn ? "Turn camera off" : "Turn camera on"}
              className="flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white"
            >
              {camOn ? (
                <Camera className="h-3 w-3" />
              ) : (
                <CameraOff className="h-3 w-3 text-rose-400" />
              )}
            </button>
          )}
          {onLeave && (
            <button
              type="button"
              onClick={onLeave}
              aria-label="Leave the stage"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white"
            >
              <PhoneOff className="h-3 w-3" />
            </button>
          )}
          {canRemove && (
            <button
              type="button"
              onClick={onRemove}
              aria-label="Remove guest"
              className="flex h-6 w-6 items-center justify-center rounded-full bg-rose-600 text-white"
            >
              <UserX className="h-3 w-3" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Multi-guest stage.
 *
 * A full WebRTC mesh on a dedicated `coolerup-live-stage-<liveId>` broadcast
 * channel, deliberately separate from the viewer stream channel so the two
 * never fight over peer ids. The host and up to {@link MAX_GUESTS} guests each
 * publish camera + mic; everyone sees everyone in a TikTok-style grid.
 *
 * Glare is avoided deterministically: when two peers discover each other, the
 * one with the lexicographically smaller id sends the offer.
 */
export function LiveMultiGuest({
  liveId,
  selfId,
  selfName,
  role,
  localStream,
  guests,
  onRemoveGuest,
  onLeaveStage,
}: {
  liveId: string;
  selfId: string;
  selfName: string;
  role: "host" | "guest";
  localStream: MediaStream | null;
  guests: LiveGuest[];
  onRemoveGuest?: (userId: string) => void;
  onLeaveStage?: () => void;
}) {
  const peers = useRef(new Map<string, PeerState>());
  const helloSent = useRef(new Set<string>());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const localRef = useRef<MediaStream | null>(localStream);
  const [streams, setStreams] = useState<Record<string, MediaStream>>({});
  const [media, setMedia] = useState<Record<string, { micOn: boolean; camOn: boolean }>>({});
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);

  localRef.current = localStream;

  const nameFor = useCallback(
    (userId: string) => {
      if (userId === liveId) return "Host";
      const guest = guests.find((row) => row.user_id === userId);
      return guest ? guestName(guest) : "Guest";
    },
    [guests, liveId],
  );

  const send = useCallback((signal: StageSignal) => {
    void channelRef.current?.send({ type: "broadcast", event: "stage", payload: signal });
  }, []);

  const ensurePeer = useCallback(
    (peerId: string): PeerState => {
      const existing = peers.current.get(peerId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE);
      const stream = new MediaStream();
      const state: PeerState = { pc, stream, micOn: true, camOn: true };
      peers.current.set(peerId, state);

      localRef.current?.getTracks().forEach((track) => pc.addTrack(track, localRef.current!));

      pc.ontrack = (event) => {
        event.streams[0]?.getTracks().forEach((track) => {
          if (!stream.getTracks().some((t) => t.id === track.id)) stream.addTrack(track);
        });
        setStreams((prev) => ({ ...prev, [peerId]: stream }));
      };
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          send({
            kind: "candidate",
            from: selfId,
            to: peerId,
            candidate: event.candidate.toJSON(),
          });
        }
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "failed" || pc.connectionState === "closed") {
          pc.close();
          peers.current.delete(peerId);
          setStreams((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
        }
      };
      return state;
    },
    [selfId, send],
  );

  const makeOffer = useCallback(
    async (peerId: string) => {
      const { pc } = ensurePeer(peerId);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      send({ kind: "offer", from: selfId, to: peerId, sdp: offer });
    },
    [ensurePeer, selfId, send],
  );

  // Wire the stage channel.
  useEffect(() => {
    const channel = supabase.channel(`coolerup-live-stage-${liveId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;

    channel.on("broadcast", { event: "stage" }, ({ payload }) => {
      const signal = payload as StageSignal;
      if (!signal || signal.from === selfId) return;
      if ("to" in signal && signal.to && signal.to !== selfId) return;

      void (async () => {
        switch (signal.kind) {
          case "hello": {
            ensurePeer(signal.from);
            if (!helloSent.current.has(signal.from)) {
              helloSent.current.add(signal.from);
              send({ kind: "hello", from: selfId, to: signal.from, name: selfName });
            }
            if (selfId < signal.from) await makeOffer(signal.from);
            break;
          }
          case "offer": {
            const { pc } = ensurePeer(signal.from);
            await pc.setRemoteDescription(signal.sdp);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            send({ kind: "answer", from: selfId, to: signal.from, sdp: answer });
            break;
          }
          case "answer": {
            const peer = peers.current.get(signal.from);
            if (peer) await peer.pc.setRemoteDescription(signal.sdp);
            break;
          }
          case "candidate": {
            const peer = peers.current.get(signal.from);
            if (peer) await peer.pc.addIceCandidate(signal.candidate).catch(() => undefined);
            break;
          }
          case "media": {
            setMedia((prev) => ({
              ...prev,
              [signal.from]: { micOn: signal.micOn, camOn: signal.camOn },
            }));
            break;
          }
          case "bye": {
            const peer = peers.current.get(signal.from);
            peer?.pc.close();
            peers.current.delete(signal.from);
            setStreams((prev) => {
              const next = { ...prev };
              delete next[signal.from];
              return next;
            });
            break;
          }
        }
      })();
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        send({ kind: "hello", from: selfId, name: selfName });
      }
    });

    return () => {
      peers.current.forEach((peer) => peer.pc.close());
      peers.current.clear();
      helloSent.current.clear();
      void supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [liveId, selfId, selfName, ensurePeer, makeOffer, send]);

  // Announce our own media state.
  const broadcastMedia = useCallback(
    (nextMic: boolean, nextCam: boolean) => {
      send({ kind: "media", from: selfId, micOn: nextMic, camOn: nextCam });
    },
    [selfId, send],
  );

  const toggleMic = useCallback(() => {
    const next = !micOn;
    localRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = next;
    });
    setMicOn(next);
    broadcastMedia(next, camOn);
  }, [micOn, camOn, broadcastMedia]);

  const toggleCam = useCallback(() => {
    const next = !camOn;
    localRef.current?.getVideoTracks().forEach((track) => {
      track.enabled = next;
    });
    setCamOn(next);
    broadcastMedia(micOn, next);
  }, [micOn, camOn, broadcastMedia]);

  const hostStream = role === "host" ? localStream : (streams[liveId] ?? null);
  const hostMedia =
    role === "host" ? { micOn, camOn } : (media[liveId] ?? { micOn: true, camOn: true });

  const tiles = useMemo(() => 1 + guests.length, [guests.length]);

  return (
    <div className={`grid h-full w-full gap-1.5 ${guestGridClass(tiles)}`}>
      <VideoTile
        stream={hostStream}
        label={`@${nameFor(liveId)}`}
        isHost
        isSelf={role === "host"}
        micOn={hostMedia.micOn}
        camOn={hostMedia.camOn}
        {...(role === "host" ? { onToggleMic: toggleMic, onToggleCam: toggleCam } : {})}
      />
      {guests.map((guest) => {
        const isSelf = guest.user_id === selfId;
        const stream = isSelf ? localStream : (streams[guest.user_id] ?? null);
        const state = isSelf
          ? { micOn, camOn }
          : (media[guest.user_id] ?? { micOn: true, camOn: true });
        return (
          <VideoTile
            key={guest.id}
            stream={stream}
            label={`@${guestName(guest)}`}
            isSelf={isSelf}
            micOn={state.micOn}
            camOn={state.camOn}
            {...(isSelf
              ? {
                  onToggleMic: toggleMic,
                  onToggleCam: toggleCam,
                  ...(onLeaveStage ? { onLeave: onLeaveStage } : {}),
                }
              : role === "host" && onRemoveGuest
                ? { canRemove: true, onRemove: () => onRemoveGuest(guest.user_id) }
                : {})}
          />
        );
      })}
    </div>
  );
}
