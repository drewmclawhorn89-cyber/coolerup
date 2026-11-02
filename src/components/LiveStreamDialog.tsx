import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Camera,
  Circle,
  Coins,
  Eye,
  Gift,
  Loader2,
  MessageCircle,
  Radio,
  Send,
  Signal,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MusicPlayer, useMusicPlayer } from "@/components/MusicPlayer";
import { GiftAnimation, type GiftAnimationEvent } from "@/components/GiftAnimation";
import { LiveGiftPanel } from "@/components/LiveGiftPanel";
import { supabase } from "@/integrations/supabase/client";
import { openAuthDialog } from "@/hooks/useAuth";
import { useChristmasMode } from "@/lib/christmas";
import { isLiteMode, useNetwork } from "@/lib/network";
import {
  giftById,
  giftMessage,
  notifyCoinsChanged,
  playGiftDing,
  earningsFromCoins,
  sendLiveGift,
  tickerLine,
  topGifterLine,
  useCoins,
  type GiftCount,
  type GiftFeedRow,
  type LiveGift,
} from "@/lib/coins";

type Mode = "host" | "viewer" | null;
type LiveHost = { userId: string; username: string; title: string; since: number };
type ChatMessage = {
  id: string;
  username: string;
  body: string;
  at: number;
  self?: boolean;
  /** Gift lines get the pink treatment in the chat list. */
  gift?: boolean;
};

/** What travels over the realtime channel when someone sends a gift. */
type GiftPayload = {
  id: string;
  giftType: string;
  quantity: number;
  coins: number;
  sender: string;
  senderId?: string;
  at: number;
};
const CHAT_LIMIT = 200;
type Presence = {
  userId?: string;
  username?: string;
  title?: string;
  since?: number;
  live?: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
  username?: string | null;
  onRecord: () => void;
  onPhoto: () => void;
  onUpload: () => void;
};

const viewerId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `viewer-${Date.now()}-${Math.random().toString(36).slice(2)}`;

/** Scrolling "John sent Lion 🦁" strip, TikTok style. */
function GiftTicker({ rows }: { rows: GiftFeedRow[] }) {
  if (rows.length === 0) return null;
  const line = rows.map(tickerLine).join("   \u00b7   ");
  return (
    <div className="overflow-hidden rounded-full bg-black/55 px-3 py-1.5 text-[11px] font-bold text-white/85 backdrop-blur">
      <div className="gift-ticker-track">
        <span>{line}</span>
        <span aria-hidden="true">{line}</span>
      </div>
    </div>
  );
}

export function LiveStreamDialog({
  open,
  onOpenChange,
  userId,
  username,
  onRecord,
  onPhoto,
  onUpload,
}: Props) {
  const music = useMusicPlayer();
  const [mode, setMode] = useState<Mode>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [liveNow, setLiveNow] = useState<LiveHost[]>([]);
  const [title, setTitle] = useState("");
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [viewers, setViewers] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [ended, setEnded] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [chatOpen, setChatOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  const chatEnd = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const directory = useRef<any>(null);
  const room = useRef<any>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerToken = useRef(viewerId());
  const viewerSet = useRef<Set<string>>(new Set());

  // --- gifts -----------------------------------------------------------------
  const navigate = useNavigate();
  const christmas = useChristmasMode();
  const network = useNetwork();
  const lite = isLiteMode(network);
  const wallet = useCoins(userId);
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftEvents, setGiftEvents] = useState<GiftAnimationEvent[]>([]);
  const [giftFeed, setGiftFeed] = useState<GiftFeedRow[]>([]);
  const [sendingGift, setSendingGift] = useState(false);

  /** Who receives the gift: the host, whichever side we're on. */
  const receiverId = mode === "host" ? (userId ?? null) : hostId;
  const giftCoins = giftFeed.reduce((sum, row) => sum + row.coins, 0);
  const topGifter = topGifterLine(giftFeed);
  const tickerRows = giftFeed.slice(-6);

  const pushGift = useCallback(
    (payload: GiftPayload) => {
      const gift = giftById(payload.giftType);
      if (!gift) return;
      setGiftFeed((current) => {
        if (current.some((row) => row.id === payload.id)) return current;
        const row: GiftFeedRow = {
          id: payload.id,
          gift_type: payload.giftType,
          coins: payload.coins,
          quantity: payload.quantity,
          sender_id: payload.senderId ?? "guest",
          created_at: new Date(payload.at).toISOString(),
          sender: { handle: payload.sender, username: payload.sender },
        };
        return [...current, row].slice(-60);
      });
      setGiftEvents((current) => [
        ...current.slice(-1),
        {
          id: payload.id,
          gift,
          quantity: payload.quantity,
          sender: payload.sender,
          self: payload.senderId === userId,
        },
      ]);
      pushMessage({
        id: `gift-${payload.id}`,
        username: payload.sender,
        body: giftMessage(payload.sender, gift, payload.quantity),
        at: payload.at,
        gift: true,
      });
      playGiftDing(payload.coins);
    },
    [userId],
  );

  const dismissGift = useCallback((id: string) => {
    setGiftEvents((current) => current.filter((event) => event.id !== id));
  }, []);

  /** Loads the gifts already sent in this stream so the board isn't empty. */
  const loadGiftHistory = useCallback(async (liveId: string) => {
    const { data, error } = await supabase
      .from("live_gifts")
      .select(
        "id, gift_type, coins, quantity, sender_id, created_at, sender:profiles!live_gifts_sender_id_fkey(handle, username, avatar_url)",
      )
      .eq("live_id", liveId)
      .order("created_at", { ascending: false })
      .limit(60);
    if (error || !data) return;
    setGiftFeed((data as unknown as GiftFeedRow[]).reverse());
  }, []);

  async function sendGift(gift: LiveGift, quantity: GiftCount) {
    if (!userId) {
      openAuthDialog();
      return;
    }
    if (!receiverId) {
      toast.error("This stream isn't ready for gifts yet");
      return;
    }
    if (sendingGift) return;
    setSendingGift(true);
    const result = await sendLiveGift({ liveId: receiverId, receiverId, gift, quantity });
    setSendingGift(false);

    if (!result.ok) {
      if (result.needsRecharge) {
        toast.error(result.message);
        setGiftOpen(false);
        void navigate({ to: "/coins/recharge" });
        return;
      }
      toast.error(result.message);
      return;
    }

    wallet.setBalance(result.balance);
    notifyCoinsChanged();
    setGiftOpen(false);
    const payload: GiftPayload = {
      id: result.giftId || `local-${Date.now()}`,
      giftType: gift.id,
      quantity,
      coins: gift.coins * quantity,
      sender: username || "you",
      ...(userId ? { senderId: userId } : {}),
      at: Date.now(),
    };
    pushGift(payload);
    broadcast("gift-sent", payload as unknown as Record<string, unknown>);
  }

  useEffect(() => {
    if (!open && mode === null) return;
    const channel = supabase.channel("coolerup-live-directory", {
      config: { presence: { key: userId ?? viewerToken.current } },
    });
    directory.current = channel;
    channel.on("presence", { event: "sync" }, () => {
      const entries = Object.values(channel.presenceState()).flat() as Presence[];
      const unique = new Map<string, LiveHost>();
      entries
        .filter((entry) => entry.live && entry.userId && entry.username)
        .forEach((entry) => {
          unique.set(entry.userId!, {
            userId: entry.userId!,
            username: entry.username!,
            title: entry.title || "Live now",
            since: entry.since || Date.now(),
          });
        });
      setLiveNow([...unique.values()]);
    });
    channel.subscribe((status: string) => {
      if (status === "SUBSCRIBED" && mode === "host" && broadcasting && userId && username) {
        void channel.track({
          userId,
          username,
          title: title.trim() || "Live now",
          since: Date.now(),
          live: true,
        });
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
    navigator.mediaDevices
      ?.getUserMedia({
        video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: true,
      })
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
    if (localVideo.current && localStream.current)
      localVideo.current.srcObject = localStream.current;
  }, [cameraReady, mode]);

  useEffect(() => {
    if (remoteVideo.current && remoteStream) remoteVideo.current.srcObject = remoteStream;
  }, [remoteStream]);

  function broadcast(event: string, payload: Record<string, unknown>) {
    if (room.current) void room.current.send({ type: "broadcast", event, payload });
  }

  function pushMessage(message: ChatMessage) {
    setMessages((current) => {
      if (current.some((entry) => entry.id === message.id)) return current;
      return [...current, message].slice(-CHAT_LIMIT);
    });
    if (!chatOpen) setUnread((count) => count + 1);
  }

  function sendChat() {
    const body = draft.trim().slice(0, 240);
    if (!body) return;
    const message: ChatMessage = {
      id: `${viewerToken.current}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username: username || "you",
      body,
      at: Date.now(),
      self: true,
    };
    pushMessage(message);
    broadcast("chat-message", { id: message.id, username: message.username, body, at: message.at });
    setDraft("");
  }

  // Keep the newest message in view.
  useEffect(() => {
    if (chatOpen) chatEnd.current?.scrollIntoView({ block: "end" });
  }, [messages, chatOpen]);

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
    setHostId(null);
    setGiftFeed([]);
    setGiftEvents([]);
    setGiftOpen(false);
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
      if (event.candidate)
        broadcast("host-candidate", { to: id, candidate: event.candidate.toJSON() });
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
    const channel = supabase.channel(`coolerup-live-room-${userId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on(
      "broadcast",
      { event: "viewer-join" },
      ({ payload }: { payload: { viewerId: string } }) => {
        if (!payload.viewerId || peers.current.has(payload.viewerId)) return;
        viewerSet.current.add(payload.viewerId);
        setViewers(viewerSet.current.size);
        void createHostPeer(payload.viewerId);
      },
    );
    channel.on(
      "broadcast",
      { event: "viewer-answer" },
      async ({ payload }: { payload: { viewerId: string; sdp: RTCSessionDescriptionInit } }) => {
        const peer = peers.current.get(payload.viewerId);
        if (peer && !peer.currentRemoteDescription)
          await peer.setRemoteDescription(payload.sdp).catch(() => {});
      },
    );
    channel.on(
      "broadcast",
      { event: "viewer-candidate" },
      async ({ payload }: { payload: { viewerId: string; candidate: RTCIceCandidateInit } }) => {
        const peer = peers.current.get(payload.viewerId);
        if (peer?.remoteDescription) await peer.addIceCandidate(payload.candidate).catch(() => {});
      },
    );
    channel.on(
      "broadcast",
      { event: "viewer-leave" },
      ({ payload }: { payload: { viewerId: string } }) => {
        peers.current.get(payload.viewerId)?.close();
        peers.current.delete(payload.viewerId);
        viewerSet.current.delete(payload.viewerId);
        setViewers(viewerSet.current.size);
      },
    );
    channel.on("broadcast", { event: "chat-message" }, ({ payload }: { payload: ChatMessage }) => {
      if (!payload?.id || !payload.body) return;
      pushMessage({
        id: payload.id,
        username: payload.username || "guest",
        body: String(payload.body).slice(0, 240),
        at: payload.at || Date.now(),
      });
    });
    channel.on("broadcast", { event: "gift-sent" }, ({ payload }: { payload: GiftPayload }) => {
      if (!payload?.id || !payload.giftType) return;
      pushGift(payload);
    });
    room.current = channel;
    channel.subscribe((status: string) => {
      if (status !== "SUBSCRIBED") return;
      setBroadcasting(true);
      void loadGiftHistory(userId);
      void directory.current?.track({
        userId,
        username,
        title: title.trim() || "Live now",
        since: Date.now(),
        live: true,
      });
      toast.success("You are live!");
    });
  }

  async function joinLive(host: LiveHost) {
    setMode("viewer");
    setHostId(host.userId);
    setGiftFeed([]);
    void loadGiftHistory(host.userId);
    setConnecting(true);
    setEnded(false);
    const channel = supabase.channel(`coolerup-live-room-${host.userId}`, {
      config: { broadcast: { self: false } },
    });
    channel.on(
      "broadcast",
      { event: "host-offer" },
      async ({ payload }: { payload: { to: string; sdp: RTCSessionDescriptionInit } }) => {
        if (payload.to !== viewerToken.current) return;
        const peer = new RTCPeerConnection({
          iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
        });
        peers.current.set(host.userId, peer);
        peer.ontrack = (event) => {
          setRemoteStream(event.streams[0] ?? null);
          setConnecting(false);
        };
        peer.onicecandidate = (event) => {
          if (event.candidate)
            broadcast("viewer-candidate", {
              viewerId: viewerToken.current,
              candidate: event.candidate.toJSON(),
            });
        };
        await peer.setRemoteDescription(payload.sdp);
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        broadcast("viewer-answer", { viewerId: viewerToken.current, sdp: answer });
      },
    );
    channel.on(
      "broadcast",
      { event: "host-candidate" },
      async ({ payload }: { payload: { to: string; candidate: RTCIceCandidateInit } }) => {
        if (payload.to === viewerToken.current)
          await peers.current
            .get(host.userId)
            ?.addIceCandidate(payload.candidate)
            .catch(() => {});
      },
    );
    channel.on("broadcast", { event: "stream-ended" }, () => {
      setEnded(true);
      setConnecting(false);
      setRemoteStream(null);
    });
    channel.on("broadcast", { event: "chat-message" }, ({ payload }: { payload: ChatMessage }) => {
      if (!payload?.id || !payload.body) return;
      pushMessage({
        id: payload.id,
        username: payload.username || "guest",
        body: String(payload.body).slice(0, 240),
        at: payload.at || Date.now(),
      });
    });
    channel.on("broadcast", { event: "gift-sent" }, ({ payload }: { payload: GiftPayload }) => {
      if (!payload?.id || !payload.giftType) return;
      pushGift(payload);
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
          <DialogTitle className="px-4 pt-6 font-display text-2xl sm:px-6">
            Create something
          </DialogTitle>
          <DialogDescription className="px-4 text-sm text-zinc-400 sm:px-6">
            Share a moment with the Coolerup community.
          </DialogDescription>
          <div className="space-y-3 px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-2 sm:px-6">
            <button
              onClick={() => {
                closeMenu();
                void startHost();
              }}
              disabled={!userId}
              className="flex w-full items-center gap-4 rounded-2xl border border-primary/40 bg-primary/10 p-4 text-left transition hover:bg-primary/20 disabled:opacity-50"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-white">
                <Radio />
              </span>
              <span className="min-w-0">
                <span className="block font-bold">Go live</span>
                <span className="text-sm text-zinc-400">Broadcast from your camera</span>
              </span>
              <Circle className="ml-auto h-3 w-3 fill-red-500 text-red-500" />
            </button>
            <div className="rounded-2xl border border-white/10 p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-zinc-500">
                <Signal className="h-3.5 w-3.5" /> Live now
              </div>
              {liveNow.length === 0 ? (
                <p className="py-2 text-sm text-zinc-500">
                  No one is live right now. Start the first stream.
                </p>
              ) : (
                <div className="space-y-2">
                  {liveNow.map((host) => (
                    <button
                      key={host.userId}
                      onClick={() => {
                        closeMenu();
                        void joinLive(host);
                      }}
                      className="flex w-full items-center gap-3 rounded-xl bg-white/5 p-3 text-left hover:bg-white/10"
                    >
                      <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold">@{host.username}</span>
                        <span className="block truncate text-xs text-zinc-400">{host.title}</span>
                      </span>
                      <Eye className="h-4 w-4 text-zinc-400" />
                    </button>
                  ))}
                </div>
              )}
            </div>
            <MusicPlayer player={music} open={open} />
            <button
              onClick={() => {
                closeMenu();
                onRecord();
              }}
              className="flex w-full items-center gap-4 rounded-2xl border border-white/10 p-4 text-left hover:bg-white/5"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Camera />
              </span>
              <span className="min-w-0">
                <span className="block font-bold">Record a video</span>
                <span className="text-sm text-zinc-400">Capture a short moment</span>
              </span>
            </button>
            <button
              onClick={() => {
                closeMenu();
                onPhoto();
              }}
              className="flex w-full items-center gap-4 rounded-2xl border border-white/10 p-4 text-left hover:bg-white/5"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Camera />
              </span>
              <span className="min-w-0">
                <span className="block font-bold">Take a photo</span>
                <span className="text-sm text-zinc-400">Snap a pic with filters</span>
              </span>
            </button>
            <button
              onClick={() => {
                closeMenu();
                onUpload();
              }}
              className="flex w-full items-center gap-4 rounded-2xl border border-white/10 p-4 text-left hover:bg-white/5"
            >
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-white/10">
                <Video />
              </span>
              <span className="min-w-0">
                <span className="block font-bold">Upload a video</span>
                <span className="text-sm text-zinc-400">Choose a video or photo</span>
              </span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={mode !== null}
        onOpenChange={(next) => {
          if (!next) finish();
        }}
      >
        <DialogContent className="block h-[100dvh] w-screen max-w-none overflow-hidden border-0 bg-black p-0 text-white sm:aspect-[9/16] sm:h-[min(100dvh,56rem)] sm:w-auto sm:rounded-2xl [&>button:last-child]:hidden">
          <DialogTitle className="sr-only">
            {mode === "viewer" ? "Watch live stream" : "Go live"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Live video broadcast and viewing.
          </DialogDescription>
          <div className="relative h-full w-full bg-black">
            {mode === "host" ? (
              <video
                ref={localVideo}
                autoPlay
                muted
                playsInline
                className="h-full w-full object-cover"
              />
            ) : (
              <video
                ref={remoteVideo}
                autoPlay
                playsInline
                className="h-full w-full object-cover"
              />
            )}
            {giftEvents.map((event) => (
              <GiftAnimation key={event.id} event={event} lowData={lite} onDone={dismissGift} />
            ))}
            {mode === "host" && !cameraReady && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                {cameraError ? (
                  <>
                    <Camera className="h-8 w-8 text-white/60" />
                    <p className="text-sm text-white/80">{cameraError}</p>
                  </>
                ) : (
                  <>
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="text-sm text-white/70">Starting your camera…</p>
                  </>
                )}
              </div>
            )}
            {mode === "viewer" && !remoteStream && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                <Radio className="h-10 w-10 text-primary" />
                <p className="font-display text-2xl">
                  {ended
                    ? "Stream ended"
                    : `@${liveNow.find((host) => host.userId === room.current?.topic?.split("-").pop())?.username ?? "creator"} is live`}
                </p>
                <p className="text-sm text-white/65">
                  {ended
                    ? "This broadcast has finished."
                    : connecting
                      ? "Connecting to the live stream…"
                      : "Waiting for video…"}
                </p>
              </div>
            )}
            <div className="absolute inset-x-0 top-0 flex items-center justify-between bg-gradient-to-b from-black/70 to-transparent p-4 pt-[max(1rem,env(safe-area-inset-top))]">
              <button
                onClick={finish}
                aria-label="Close live stream"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-black/40"
              >
                <X className="h-5 w-5" />
              </button>
              {mode === "host" && broadcasting ? (
                <span className="flex items-center gap-2 rounded-full bg-red-600 px-3 py-1.5 text-xs font-extrabold tracking-wider">
                  <Circle className="h-2 w-2 fill-white" /> LIVE{" "}
                  <span className="ml-1 flex items-center gap-1 font-medium">
                    <Eye className="h-3.5 w-3.5" />
                    {viewers}
                  </span>
                </span>
              ) : mode === "viewer" ? (
                <span className="rounded-full bg-red-600 px-3 py-1.5 text-xs font-extrabold tracking-wider">
                  LIVE
                </span>
              ) : (
                <span className="h-10 w-10" />
              )}
              <button
                onClick={() => {
                  setChatOpen((value) => !value);
                  setUnread(0);
                }}
                aria-label={chatOpen ? "Hide live chat" : "Show live chat"}
                aria-pressed={chatOpen}
                className="relative flex h-10 w-10 items-center justify-center rounded-full bg-black/40"
              >
                <MessageCircle className="h-5 w-5" />
                {unread > 0 && !chatOpen && (
                  <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </button>
            </div>
            {(topGifter || giftCoins > 0) && (
              <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+4.25rem)] flex flex-col items-center gap-1 px-4">
                {topGifter && (
                  <span className="max-w-full truncate rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-yellow-300 backdrop-blur">
                    🏆 {topGifter}
                  </span>
                )}
                {giftCoins > 0 && (
                  <span className="rounded-full bg-[#fe2c55]/90 px-3 py-1 text-[11px] font-extrabold text-white">
                    🎁 {giftCoins.toLocaleString()} coins this stream
                  </span>
                )}
              </div>
            )}
            {mode === "host" ? (
              <div className="absolute inset-x-0 bottom-0 space-y-3 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
                {broadcasting && (
                  <div className="space-y-2">
                    <GiftTicker rows={tickerRows} />
                    <div className="max-h-40 space-y-1.5 overflow-y-auto overscroll-contain pr-1 text-sm">
                      {messages.length === 0 ? (
                        <p className="text-xs text-white/50">Live chat will appear here.</p>
                      ) : (
                        messages.map((message) => (
                          <p
                            key={message.id}
                            className={`break-words rounded-2xl px-3 py-1.5 ${
                              message.gift
                                ? "bg-[#fe2c55]/25 font-bold text-white ring-1 ring-[#fe2c55]/50"
                                : "bg-black/45 text-white/90"
                            }`}
                          >
                            {message.gift ? (
                              <span>{message.body}</span>
                            ) : (
                              <>
                                <span className="font-bold text-primary">@{message.username}</span>{" "}
                                <span>{message.body}</span>
                              </>
                            )}
                          </p>
                        ))
                      )}
                      <div ref={chatEnd} />
                    </div>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        sendChat();
                      }}
                      className="flex items-center gap-2"
                    >
                      <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value.slice(0, 240))}
                        placeholder="Say something to your viewers…"
                        aria-label="Chat message"
                        className="min-w-0 flex-1 rounded-full bg-white/15 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/60"
                      />
                      <button
                        type="submit"
                        aria-label="Send chat message"
                        disabled={!draft.trim()}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40"
                      >
                        <Send className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2 rounded-full bg-white/10 px-3 py-2 text-[11px] font-bold">
                  <span className="flex min-w-0 items-center gap-1.5 truncate">
                    <Coins className="h-3.5 w-3.5 shrink-0 text-yellow-400" />
                    {giftCoins.toLocaleString()} coins today · {earningsFromCoins(giftCoins).usd}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      finish();
                      void navigate({ to: "/live/dashboard" });
                    }}
                    className="shrink-0 rounded-full bg-white/20 px-3 py-1"
                  >
                    Gift dashboard
                  </button>
                </div>
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value.slice(0, 80))}
                  disabled={broadcasting}
                  placeholder="What are you going live about?"
                  className="w-full rounded-full bg-white/15 px-4 py-3 text-base text-white outline-none placeholder:text-white/65 disabled:opacity-70"
                />
                {!broadcasting ? (
                  <button
                    onClick={() => void startBroadcast()}
                    disabled={!cameraReady || Boolean(cameraError)}
                    className="w-full rounded-full bg-primary py-3.5 font-extrabold disabled:opacity-50"
                  >
                    {cameraReady ? "Start live stream" : "Camera required"}
                  </button>
                ) : (
                  <button
                    onClick={finish}
                    className="w-full rounded-full bg-white py-3.5 font-extrabold text-black"
                  >
                    End live
                  </button>
                )}
                <p className="text-center text-xs text-white/65">
                  Peer-to-peer beta · connection quality depends on viewers&apos; networks.
                </p>
              </div>
            ) : (
              <div className="absolute inset-x-0 bottom-0 space-y-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-10">
                <GiftTicker rows={tickerRows} />
                <div className="max-h-44 space-y-1.5 overflow-y-auto overscroll-contain pr-1 text-sm">
                  {messages.length === 0 ? (
                    <p className="text-xs text-white/50">Be the first to say hi.</p>
                  ) : (
                    messages.map((message) => (
                      <p
                        key={message.id}
                        className={`break-words rounded-2xl px-3 py-1.5 ${
                          message.gift
                            ? "bg-[#fe2c55]/25 font-bold text-white ring-1 ring-[#fe2c55]/50"
                            : "bg-black/45 text-white/90"
                        }`}
                      >
                        {message.gift ? (
                          <span>{message.body}</span>
                        ) : (
                          <>
                            <span className="font-bold text-primary">@{message.username}</span>{" "}
                            <span>{message.body}</span>
                          </>
                        )}
                      </p>
                    ))
                  )}
                  <div ref={chatEnd} />
                </div>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendChat();
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    value={draft}
                    onChange={(event) => setDraft(event.target.value.slice(0, 240))}
                    placeholder="Add a comment…"
                    aria-label="Chat message"
                    className="min-w-0 flex-1 rounded-full bg-white/15 px-4 py-2.5 text-sm text-white outline-none placeholder:text-white/60"
                  />
                  <button
                    type="button"
                    onClick={() => (userId ? setGiftOpen(true) : openAuthDialog())}
                    aria-label="Send a gift"
                    className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#fe2c55] text-white shadow-lg shadow-[#fe2c55]/40 transition active:scale-95"
                  >
                    <Gift className="h-5 w-5" />
                    {wallet.balance != null && wallet.balance > 0 && (
                      <span className="absolute -right-1 -top-1 rounded-full bg-yellow-400 px-1 text-[9px] font-extrabold leading-4 text-black">
                        {wallet.balance > 999 ? "999+" : wallet.balance}
                      </span>
                    )}
                  </button>
                  <button
                    type="submit"
                    aria-label="Send chat message"
                    disabled={!draft.trim()}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </form>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-bold">
                    {remoteStream ? "You're watching live" : "Joining stream"}
                  </p>
                  <button
                    onClick={finish}
                    className="rounded-full bg-white/15 px-4 py-2 text-sm font-bold"
                  >
                    Leave
                  </button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <LiveGiftPanel
        open={giftOpen}
        onOpenChange={setGiftOpen}
        christmas={christmas}
        balance={wallet.balance}
        signedIn={Boolean(userId)}
        sending={sendingGift}
        onSend={(gift, quantity) => void sendGift(gift, quantity)}
        onRecharge={() => {
          setGiftOpen(false);
          void navigate({ to: "/coins/recharge" });
        }}
        onSignIn={() => {
          setGiftOpen(false);
          openAuthDialog();
        }}
      />
    </>
  );
}
