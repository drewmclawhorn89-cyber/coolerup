import { useEffect, useRef, useState } from "react";
import { Camera, Circle, Eye, Loader2, Radio, Signal, Video, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MusicPlayer, useMusicPlayer } from "@/components/MusicPlayer";
import { supabase } from "@/integrations/supabase/client";

type Mode = "host" | "viewer" | null;
type LiveHost = { userId: string; username: string; title: string; since: number };
type Presence = { userId?: string; username?: string; title?: string; since?: number; live?: boolean };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
  username?: string | null;
  onRecord: () => void;
  onPhoto: () => void;
  onUpload: () => void;
};


const viewerId = () => globalThis.crypto?.randomUUID?.() ?? `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function LiveStreamDialog({ open, onOpenChange, userId, username, onRecord, onPhoto, onUpload }: Props) {
  const music = useMusicPlayer();
  const [mode, setMode] = useState<Mode>(null);
  const [liveNow, setLiveNow] = useState<LiveHost[]>([]);
  const [title, setTitle] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [viewers, setViewers] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [ended, setEnded] = useState(false);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const directory = useRef<any>(null);
  const room = useRef<any>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerToken = useRef(viewerId());
  const viewerSet = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!open && mode === null) return;
    const channel = supabase.channel("coolerup-live-directory", {
      config: { presence: { key: userId ?? viewerToken.current } },
    });
    directory.current = channel;
    channel.on("presence", { event: "sync" }, () => {
      const entries = Object.values(channel.presenceState()).flat() as Presence[];
      const unique = new Map<string, LiveHost>();
      entries.filter((entry) => entry.live && entry.userId && entry.username).forEach((entry) => {
        unique.set(entry.userId!, {
          userId: entry.userId!, username: entry.username!, title: entry.title || "Live now", since: entry.since || Date.now(),
        });
      });
      setLiveNow([...unique.values()]);
    });
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED" && mode === "host" && broadcasting && userId && username) {
        void channel.track({ userId, username, title: title.trim() || "Live now", since: Date.now(), live: true });
      }
    });
    return () => {
      if (directory.current === channel) directory.current = null;
      void supabase.removeChannel(channel);
    };
  }, [open, mode, broadcasting, userId, username, title]);

  useEffect(() => {
    if (mode !== "host") return;
    let cancelled = false;
    setCameraReady(false);
    setCameraError("");
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        localStream.current = stream;
        if (localVideo.current) localVideo.current.srcObject = stream;
        setCameraReady(true);
      })
      .catch(() => setCameraError("Camera and microphone access is needed to go live."));
    return () => {
      cancelled = true;
      if (!broadcasting) {
        localStream.current?.getTracks().forEach((track) => track.stop());
        localStream.current = null;
      }
    };
  }, [mode]);

  useEffect(() => {
    if (localVideo.current && localStream.current) localVideo.current.srcObject = localStream.current;
  }, [cameraReady, mode]);

  useEffect(() => {
    if (remoteVideo.current && remoteStream) remoteVideo.current.srcObject = remoteStream;
  }, [remoteStream]);

  function broadcast(event: string, payload: Record<string, unknown>) {
    if (room.current) void room.current.send({ type: "broadcast", event, payload });
  }

  function closePeers() {
    peers.current.forEach((peer) => peer.close());
    peers.current.clear();
    viewerSet.current.clear();
    setViewers(0);
  }

  function finish() {
    if (mode === "host") {
      broadcast("stream-ended", { hostId: userId });
      void directory.current?.untrack();
    } else if (mode === "viewer" && room.current) {
      broadcast("viewer-leave", { viewerId: viewerToken.current });
    }
    closePeers();
    if (room.current) void supabase.removeChannel(room.current);
    room.current = null;
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    setRemoteStream(null);
    setBroadcasting(false);
    setCameraReady(false);
    setMode(null);
    setConnecting(false);
    setEnded(false);
  }

  async function createHostPeer(id: string) {
    const stream = localStream.current;
    if (!stream || !room.current || peers.current.has(id)) return;
    const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    peers.current.set(id, peer);
    stream.getTracks().forEach((track) => peer.addTrack(track, stream));
    peer.onicecandidate = (event) => {
      if (event.candidate) broadcast("host-candidate", { to: id, candidate: event.candidate.toJSON() });
    };
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        peer.close();
        peers.current.delete(id);
        viewerSet.current.delete(id);
        setViewers(viewerSet.current.size);
      }
    };
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    broadcast("host-offer", { to: id, sdp: offer });
  }

  async function startBroadcast() {
    if (!userId || !username || !localStream.current) return;
    const channel = supabase.channel(`coolerup-live-room-${userId}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "viewer-join" }, ({ payload }: { payload: { viewerId: string } }) => {
      if (!payload.viewerId || peers.current.has(payload.viewerId)) return;
      viewerSet.current.add(payload.viewerId);
      setViewers(viewerSet.current.size);
      void createHostPeer(payload.viewerId);
    });
    channel.on("broadcast", { event: "viewer-answer" }, async ({ payload }: { payload: { viewerId: string; sdp: RTCSessionDescriptionInit } }) => {
      const peer = peers.current.get(payload.viewerId);
      if (peer && !peer.currentRemoteDescription) await peer.setRemoteDescription(payload.sdp).catch(() => {});
    });
    channel.on("broadcast", { event: "viewer-candidate" }, async ({ payload }: { payload: { viewerId: string; candidate: RTCIceCandidateInit } }) => {
      const peer = peers.current.get(payload.viewerId);
      if (peer?.remoteDescription) await peer.addIceCandidate(payload.candidate).catch(() => {});
    });
    channel.on("broadcast", { event: "viewer-leave" }, ({ payload }: { payload: { viewerId: string } }) => {
      peers.current.get(payload.viewerId)?.close();
      peers.current.delete(payload.viewerId);
      viewerSet.current.delete(payload.viewerId);
      setViewers(viewerSet.current.size);
    });
    room.current = channel;
    channel.subscribe((status: string) => {
      if (status !== "SUBSCRIBED") return;
      setBroadcasting(true);
      void directory.current?.track({ userId, username, title: title.trim() || "Live now", since: Date.now(), live: true });
      toast.success("You are live!");
    });
  }

  async function joinLive(host: LiveHost) {
    setMode("viewer");
    setConnecting(true);
    setEnded(false);
    const channel = supabase.channel(`coolerup-live-room-${host.userId}`, { config: { broadcast: { self: false } } });
    channel.on("broadcast", { event: "host-offer" }, async ({ payload }: { payload: { to: string; sdp: RTCSessionDescriptionInit } }) => {
      if (payload.to !== viewerToken.current) return;
      const peer = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
      peers.current.set(host.userId, peer);
      peer.ontrack = (event) => {
        setRemoteStream(event.streams[0] ?? null);
        setConnecting(false);
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) broadcast("viewer-candidate", { viewerId: viewerToken.current, candidate: event.candidate.toJSON() });
      };
      await peer.setRemoteDescription(payload.sdp);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      broadcast("viewer-answer", { viewerId: viewerToken.current, sdp: answer });
    });
    channel.on("broadcast", { event: "host-candidate" }, async ({ payload }: { payload: { to: string; candidate: RTCIceCandidateInit } }) => {
      if (payload.to === viewerToken.current) await peers.current.get(host.userId)?.addIceCandidate(payload.candidate).catch(() => {});
    });
    channel.on("broadcast", { event: "stream-ended" }, () => {
      setEnded(true);
      setConnecting(false);
      setRemoteStream(null);
    });
    room.current = channel;
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED") broadcast("viewer-join", { viewerId: viewerToken.current });
    });
  }

  const startHost = async () => {
    if (!userId || !username) {
      toast.error("Sign in to start a live stream.");
      return;
    }
    setMode("host");
  };

  const closeMenu = () => onOpenChange(false);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-1.5rem)] max-w-md overflow-y-auto overflow-x-hidden overscroll-contain rounded-3xl border-white/10 bg-zinc-950 p-0 text-white max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]">
          <DialogTitle className="px-4 pt-6 font-display text-2xl sm:px-6">Create something</DialogTitle>
          <DialogDescription className="px-4 text-sm text-zinc-400 sm:px-6">Share a moment with the Coolerup community.</DialogDescription>
          <div className="space-y-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
            <button onClick={() => { closeMenu(); void startHost(); }} disabled={!userId} className="flex w-full items-center gap-4 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-left transition hover:bg-primary/20 disabled:opacity-50">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white"><Radio /></span>
              <span className="min-w-0"><span className="block font-bold">Go live</span><span className="text-sm text-zinc-400">Broadcast from your camera</span></span>
              <Circle className="ml-auto h-3 w-3 fill-red-500 text-red-500" />
            </button>
            <div className="rounded-2xl border border-white/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500"><Signal className="h-3.5 w-3.5" /> Live now</div>
              {liveNow.length === 0 ? <p className="py-2 text-sm text-zinc-500">No one is live right now. Start the first stream.</p> : (
                <div className="space-y-2">{liveNow.map((host) => (
                  <button key={host.userId} onClick={() => { closeMenu(); void joinLive(host); }} className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-3 text-left hover:bg-white/10">
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-semibold">@{host.username}</span><span className="block truncate text-xs text-zinc-400">{host.title}</span></span>
                    <Eye className="h-4 w-4 text-zinc-400" />
                  </button>
                ))}</div>
              )}
            </div>
            <MusicPlayer player={music} open={open} />
            <button onClick={() => { closeMenu(); onRecord(); }} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 p-4 text-left hover:bg-white/5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10"><Camera /></span>
              <span className="min-w-0"><span className="block font-bold">Record a video</span><span className="text-sm text-zinc-400">Capture a short moment</span></span>
            </button>
            <button onClick={() => { closeMenu(); onPhoto(); }} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 p-4 text-left hover:bg-white/5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10"><Camera /></span>
              <span className="min-w-0"><span className="block font-bold">Take a photo</span><span className="text-sm text-zinc-400">Snap a pic with filters</span></span>
            </button>
            <button onClick={() => { closeMenu(); onUpload(); }} className="flex w-full items-center gap-4 rounded-2xl border border-white/10 p-4 text-left hover:bg-white/5">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10"><Video /></span>
              <span className="min-w-0"><span className="block font-bold">Upload a video</span><span className="text-sm text-zinc-400">Choose a video or photo</span></span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={mode !== null} onOpenChange={(next) => { if (!next) finish(); }}>
        <DialogContent className="block h-[100dvh] w-screen max-w-none overflow-hidden border-0 bg-black p-0 text-white sm:aspect-[9/16] sm:h-[min(100dvh,56rem)] sm:w-auto sm:rounded-2xl [&>button:last-child]:hidden">
          <DialogTitle className="sr-only">{mode === "viewer" ? "Watch live stream" : "Go live"}</DialogTitle>
          <DialogDescription className="sr-only">Live video broadcast and viewing.</DialogDescription>
          <div className="relative h-full w-full bg-black">
            {mode === "host" ? <video ref={localVideo} autoPlay muted playsInline className="h-full w-full object-cover" /> : <video ref={remoteVideo} autoPlay playsInline className="h-full w-full object-cover" />}
            {mode === "host" && !cameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                {cameraError ? <><Camera className="h-8 w-8 text-white/60" /><p className="text-sm text-white/80">{cameraError}</p></> : <><Loader2 className="h-8 w-8 animate-spin" /><p className="text-sm text-white/70">Starting your camera…</p></>}
              </div>
            )}
            {mode === "viewer" && !remoteStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                <Radio className="h-10 w-10 text-primary" />
                <p className="font-display text-2xl">{ended ? "Stream ended" : `@${liveNow.find((host) => host.userId === room.current?.topic?.split("-").pop())?.username ?? "creator"} is live`}</p>
                <p className="text-sm text-white/65">{ended ? "This broadcast has finished." : connecting ? "Connecting to the live stream…" : "Waiting for video…"}</p>
              </div>
            )}
            <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
              <button onClick={finish} aria-label="Close live stream" className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40"><X className="h-5 w-5" /></button>
              {mode === "host" && broadcasting ? <span className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-xs font-extrabold tracking-wider"><Circle className="h-2 w-2 fill-white" /> LIVE <span className="ml-1 flex items-center gap-1 font-medium"><Eye className="h-3.5 w-3.5" />{viewers}</span></span> : mode === "viewer" ? <span className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-extrabold tracking-wider">LIVE</span> : <span className="h-10 w-10" />}
            </div>
            {mode === "host" ? (
              <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/80 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-14">
                <input value={title} onChange={(event) => setTitle(event.target.value.slice(0, 80))} disabled={broadcasting} placeholder="What are you going live about?" className="w-full rounded-full bg-white/15 px-4 py-3 text-base text-white outline-none placeholder:text-white/65 disabled:opacity-70" />
                {!broadcasting ? <button onClick={() => void startBroadcast()} disabled={!cameraReady || Boolean(cameraError)} className="w-full rounded-full bg-primary py-3.5 font-extrabold disabled:opacity-50">{cameraReady ? "Start live stream" : "Camera required"}</button> : <button onClick={finish} className="w-full rounded-full bg-white py-3.5 font-extrabold text-black">End live</button>}
                <p className="text-center text-xs text-white/65">Peer-to-peer beta · connection quality depends on viewers&apos; networks.</p>
              </div>
            ) : (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/80 to-transparent px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-16">
                <p className="font-bold">{remoteStream ? "You&apos;re watching live" : "Joining stream"}</p>
                <button onClick={finish} className="rounded-full bg-white/15 px-4 py-2 text-sm font-bold">Leave</button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
