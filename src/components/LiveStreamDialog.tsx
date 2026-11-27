import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Camera,
  Circle,
  Eye,
  Gift,
  Heart,
  Loader2,
  MessageCircle,
  MessageSquareOff,
  MoreVertical,
  Pin,
  PinOff,
  Radio,
  Share2,
  Shield,
  ShieldCheck,
  Signal,
  UserPlus,
  Users,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { MusicPlayer, useMusicPlayer } from "@/components/MusicPlayer";
import { GiftAnimation, type GiftAnimationEvent } from "@/components/GiftAnimation";
import { LiveGiftPanel } from "@/components/LiveGiftPanel";
import { LiveCoinSheet } from "@/components/LiveCoinSheet";
import { CoinVenmoSheet } from "@/components/CoinVenmoSheet";
import { myCoinVenmoOrders, type CoinVenmoOrderResult } from "@/lib/coins.functions";
import { LiveModPanel } from "@/components/LiveModPanel";
import { GifPicker } from "@/components/GifPicker";
import { LiveJoinBanner, LiveJoinRequestSheet } from "@/components/LiveJoinRequest";
import { LiveMultiGuest } from "@/components/LiveMultiGuest";
import type { RealtimeChannel } from "@supabase/supabase-js";

import { supabase } from "@/integrations/supabase/client";
import { useLiveDirectory, type LiveHost } from "@/lib/liveDirectory";
import { openAuthDialog } from "@/hooks/useAuth";
import { followUser, isFollowing, unfollowUser } from "@/lib/follow";
import { useChristmasMode } from "@/lib/christmas";
import { isLiteMode, useNetwork } from "@/lib/network";
import {
  MUTE_OPTIONS,
  addModerator,
  blockAnnouncement,
  canModerate,
  displayName,
  endLiveSession,
  modAnnouncement,
  muteAnnouncement,
  muteUser,
  pinMessage,
  removeModerator,
  roleFor,
  setCommentsOff,
  unmodAnnouncement,
  unmuteUser,
  useLiveModeration,
  type LiveMod,
  type LiveMute,
  type PinnedMessage,
} from "@/lib/liveMods";
import {
  JOIN_STATUS_COPY,
  leaveGuestStage,
  liveWithLine,
  requestName,
  respondToJoinRequest,
  useJoinRequests,
  useMyJoinRequest,
  type JoinRequest,
  type LiveGuest,
} from "@/lib/liveJoin";
import {
  giftById,
  giftMessage,
  notifyCoinsChanged,
  playGiftDing,
  earningsFromCoins,
  sendLiveGift,
  tickerLine,
  topGifters,
  useCoins,
  type GiftCount,
  type GiftFeedRow,
  type LiveGift,
} from "@/lib/coins";

type Mode = "host" | "viewer" | null;
type ChatMessage = {
  id: string;
  username: string;
  body: string;
  at: number;
  /** Optional GIF URL (Giphy or user-made) shown under the message. */
  gif?: string;
  /** "Made by @handle" for user-made GIFs. */
  gifCredit?: string;
  self?: boolean;
  /** Gift lines get the pink treatment in the chat list. */
  gift?: boolean;
  /** System lines (mod promotions, mutes) render muted and centred. */
  system?: boolean;
  /** Author id, so tapping a name can open the right moderation menu. */
  userId?: string;
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId?: string;
  username?: string | null;
  /** Deep link: open straight into watching this host. */
  initialHost?: { userId: string; username: string };
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

/** Top three gifters in this stream, TikTok leaderboard style. */
function GiftLeaderboard({ rows }: { rows: GiftFeedRow[] }) {
  const top = topGifters(rows, 3);
  if (top.length === 0) return null;
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="flex flex-col items-center gap-1" data-testid="gift-leaderboard">
      {top.map((gifter, index) => (
        <span
          key={gifter.userId}
          className="max-w-full truncate rounded-full bg-black/60 px-3 py-1 text-[11px] font-bold text-yellow-300 backdrop-blur"
        >
          {medals[index]} @{gifter.name} · {gifter.coins.toLocaleString()} 🪙
        </span>
      ))}
    </div>
  );
}

export function LiveStreamDialog({
  open,
  onOpenChange,
  userId,
  username,
  initialHost,
  onRecord,
  onPhoto,
  onUpload,
}: Props) {
  const music = useMusicPlayer();
  const [mode, setMode] = useState<Mode>(null);
  const [hostId, setHostId] = useState<string | null>(null);
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
  const [draftGif, setDraftGif] = useState<string | null>(null);
  const [draftGifCredit, setDraftGifCredit] = useState<string | null>(null);
  const [showGifPicker, setShowGifPicker] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [unread, setUnread] = useState(0);
  /** TikTok-style overflow menu (Guests / Mods / comments / end live). */
  const [menuOpen, setMenuOpen] = useState(false);
  /** X taps ask before ending a broadcast instead of showing a big button. */
  const [endConfirm, setEndConfirm] = useState(false);
  /** Floating hearts fired from the heart button. */
  const [hearts, setHearts] = useState<{ id: number; drift: number }[]>([]);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const chatEnd = useRef<HTMLDivElement>(null);
  const localVideo = useRef<HTMLVideoElement>(null);
  const remoteVideo = useRef<HTMLVideoElement>(null);
  const localStream = useRef<MediaStream | null>(null);
  const room = useRef<RealtimeChannel | null>(null);
  const peers = useRef<Map<string, RTCPeerConnection>>(new Map());
  const viewerToken = useRef(viewerId());
  const viewerSet = useRef<Set<string>>(new Set());

  // Shared presence directory: everyone currently broadcasting on Coolerup.
  const { hosts: liveNow, channel: directory } = useLiveDirectory({
    enabled: open || mode !== null,
    key: userId ?? viewerToken.current,
    host: mode === "host" && broadcasting ? { userId, username, title } : null,
  });

  // --- mods / guests ---------------------------------------------------------
  const [modOpen, setModOpen] = useState(false);
  const [joinSheetOpen, setJoinSheetOpen] = useState(false);
  const [nameMenu, setNameMenu] = useState<{
    username: string;
    userId: string | null;
    message?: ChatMessage;
  } | null>(null);
  const [joinPrompt, setJoinPrompt] = useState(false);
  const [busyMod, setBusyMod] = useState(false);

  const liveId = mode === "host" ? (userId ?? null) : hostId;
  const moderation = useLiveModeration(liveId);
  const joinState = useJoinRequests(liveId, Boolean(liveId));
  const myJoin = useMyJoinRequest(liveId, userId);
  const role = roleFor({ hostId: liveId, userId: userId ?? null, mods: moderation.mods });
  const isMod = canModerate(role);
  const isHost = role === "host";

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

  // --- in-stream coin purchases (Venmo) --------------------------------------
  type ReadyOrder = Extract<CoinVenmoOrderResult, { ok: true }>;
  const [coinOpen, setCoinOpen] = useState(false);
  const [venmoOpen, setVenmoOpen] = useState(false);
  const [activeOrder, setActiveOrder] = useState<ReadyOrder | null>(null);

  /** Opens the Venmo sheet for an order created inside the stream. */
  const openVenmoForOrder = useCallback((order: ReadyOrder) => {
    setCoinOpen(false);
    setActiveOrder(order);
    setVenmoOpen(true);
  }, []);

  /**
   * While the Venmo sheet is open, check whether an admin has matched the
   * payment. When it lands, refresh the wallet so the gift panel is usable
   * immediately without reloading the stream.
   */
  useEffect(() => {
    if (!venmoOpen || !userId || !activeOrder) return;
    let alive = true;
    const check = async () => {
      try {
        const orders = await myCoinVenmoOrders();
        if (!alive) return;
        const paid = orders.find(
          (order) => order.id === activeOrder.orderId && order.status === "paid",
        );
        if (!paid) return;
        toast.success(`+${paid.coins.toLocaleString()} coins added`);
        notifyCoinsChanged();
        void wallet.refresh();
        setVenmoOpen(false);
        setActiveOrder(null);
      } catch {
        // Polling is best-effort; a failure shouldn't interrupt the stream.
      }
    };
    void check();
    const timer = setInterval(() => void check(), 8000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [venmoOpen, userId, activeOrder, wallet]);

  /** Who receives the gift: the host, whichever side we're on. */
  const receiverId = mode === "host" ? (userId ?? null) : hostId;
  const giftCoins = giftFeed.reduce((sum, row) => sum + row.coins, 0);
  const tickerRows = giftFeed.slice(-6);

  const hostUsername =
    mode === "host"
      ? (username ?? "you")
      : (initialHost?.username ??
        liveNow.find((host) => host.userId === hostId)?.username ??
        "host");

  const stageActive = mode === "host" ? joinState.guests.length > 0 : myJoin.status === "accepted";

  const isModName = useCallback(
    (name: string, uid?: string) =>
      moderation.mods.some(
        (mod) => (uid && mod.user_id === uid) || displayName(mod.profile ?? {}) === name,
      ),
    [moderation.mods],
  );

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
  const loadGiftHistory = useCallback(async (id: string) => {
    const { data, error } = await supabase
      .from("live_gifts")
      .select(
        "id, gift_type, coins, quantity, sender_id, created_at, sender:profiles!live_gifts_sender_id_fkey(handle, username, avatar_url)",
      )
      .eq("live_id", id)
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
        setCoinOpen(true);
        return;
      }
      toast.error(result.message);
      return;
    }

    wallet.setBalance(result.balance);
    notifyCoinsChanged();
    // Keep the tray open so viewers can tap again and build a combo.
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

  // A viewer whose request was accepted needs their own camera for the stage.
  useEffect(() => {
    if (mode !== "viewer" || myJoin.status !== "accepted") return;
    if (localStream.current) return;
    let cancelled = false;
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
        setCameraReady(true);
      })
      .catch(() => setCameraError("Camera and microphone access is needed to join the stage."));
    return () => {
      cancelled = true;
    };
  }, [mode, myJoin.status]);

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

  /** Drops a system line into chat and mirrors it to every viewer. */
  function announce(body: string) {
    const message: ChatMessage = {
      id: `sys-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      username: "Coolerup",
      body,
      at: Date.now(),
      system: true,
    };
    pushMessage(message);
    broadcast("chat-message", {
      id: message.id,
      username: message.username,
      body,
      at: message.at,
      system: true,
    });
  }

  function sendChat() {
    const body = draft.trim().slice(0, 240);
    if (!body && !draftGif) return;
    if (moderation.commentsOff && !isMod) {
      toast.error("Comments are off in this LIVE");
      return;
    }
    const message: ChatMessage = {
      id: `${viewerToken.current}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      username: username || "you",
      body,
      at: Date.now(),
      self: true,
      ...(draftGif ? { gif: draftGif } : {}),
      ...(draftGifCredit ? { gifCredit: draftGifCredit } : {}),
      ...(userId ? { userId } : {}),
    };
    pushMessage(message);
    broadcast("chat-message", {
      id: message.id,
      username: message.username,
      body,
      at: message.at,
      ...(draftGif ? { gif: draftGif } : {}),
      ...(draftGifCredit ? { gifCredit: draftGifCredit } : {}),
      ...(userId ? { userId } : {}),
    });
    setDraft("");
    setDraftGif(null);
    setDraftGifCredit(null);
    setShowGifPicker(false);
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
      if (userId) void endLiveSession(userId);
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
    setModOpen(false);
    setJoinSheetOpen(false);
    setNameMenu(null);
    setJoinPrompt(false);
    setMenuOpen(false);
    setEndConfirm(false);
    setChatOpen(true);
    setUnread(0);
    setHearts([]);
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
      if (!payload?.id || (!payload.body && !payload.gif)) return;
      pushMessage({
        id: payload.id,
        username: payload.username || "guest",
        body: String(payload.body ?? "").slice(0, 240),
        at: payload.at || Date.now(),
        ...(payload.gif ? { gif: String(payload.gif) } : {}),
        ...(payload.gifCredit ? { gifCredit: String(payload.gifCredit).slice(0, 60) } : {}),
        ...(payload.system ? { system: true } : {}),
        ...(payload.userId ? { userId: payload.userId } : {}),
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
      if (!payload?.id || (!payload.body && !payload.gif)) return;
      pushMessage({
        id: payload.id,
        username: payload.username || "guest",
        body: String(payload.body ?? "").slice(0, 240),
        at: payload.at || Date.now(),
        ...(payload.gif ? { gif: String(payload.gif) } : {}),
        ...(payload.gifCredit ? { gifCredit: String(payload.gifCredit).slice(0, 60) } : {}),
        ...(payload.system ? { system: true } : {}),
        ...(payload.userId ? { userId: payload.userId } : {}),
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

  // Deep link: `?host=` opens straight into that stream.
  useEffect(() => {
    if (!open || !initialHost || mode) return;
    void joinLive({
      userId: initialHost.userId,
      username: initialHost.username,
      title: "Live now",
      since: Date.now(),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialHost]);

  const startHost = async () => {
    if (!userId || !username) {
      toast.error("Sign in to start a live stream.");
      return;
    }
    setMode("host");
  };

  const closeMenu = () => onOpenChange(false);

  /* ---------------------------------------------------------------------- */
  /*  Moderation actions                                                    */
  /* ---------------------------------------------------------------------- */

  async function resolveUserId(name: string): Promise<string | null> {
    const clean = name.replace(/^@/, "").trim();
    if (!clean) return null;
    const byHandle = await supabase.from("profiles").select("id").eq("handle", clean).maybeSingle();
    if (byHandle.data) return (byHandle.data as { id: string }).id;
    const byName = await supabase.from("profiles").select("id").eq("username", clean).maybeSingle();
    return byName.data ? (byName.data as { id: string }).id : null;
  }

  async function openNameMenu(message: ChatMessage) {
    if (message.gift || message.system || message.self) return;
    let uid = message.userId ?? null;
    if (!uid) uid = await resolveUserId(message.username);
    setNameMenu({ username: message.username, userId: uid, message });
  }

  async function doAddMod(targetId: string, name: string) {
    if (!liveId || !isHost) return;
    setBusyMod(true);
    const result = await addModerator(liveId, targetId);
    setBusyMod(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await moderation.refresh();
    announce(modAnnouncement(name));
    toast.success(`@${name} is now a moderator`);
    setNameMenu(null);
  }

  async function doRemoveMod(mod: LiveMod) {
    if (!liveId || !isHost) return;
    setBusyMod(true);
    const result = await removeModerator(liveId, mod.user_id);
    setBusyMod(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await moderation.refresh();
    announce(unmodAnnouncement(displayName(mod.profile ?? {})));
  }

  async function doMute(targetId: string, name: string, minutes: number | null) {
    if (!liveId || !isMod) return;
    setBusyMod(true);
    const result = await muteUser(liveId, targetId, minutes);
    setBusyMod(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await moderation.refresh();
    announce(
      muteAnnouncement(name, {
        until: minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null,
      }),
    );
    toast.success(`@${name} was muted`);
    setNameMenu(null);
  }

  async function doBlock(targetId: string, name: string) {
    if (!liveId || !isMod) return;
    setBusyMod(true);
    await muteUser(liveId, targetId, null);
    await leaveGuestStage(liveId, targetId);
    setBusyMod(false);
    await moderation.refresh();
    await joinState.refresh();
    announce(blockAnnouncement(name));
    toast.success(`@${name} was removed from this LIVE`);
    setNameMenu(null);
  }

  async function doPin(message: ChatMessage) {
    if (!liveId || !isMod) return;
    const pinned: PinnedMessage = {
      id: message.id,
      username: message.username,
      body: message.body,
      at: message.at,
    };
    const result = await pinMessage(liveId, pinned);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    moderation.setPinned(pinned);
    toast.success("Comment pinned");
    setNameMenu(null);
  }

  async function doUnpin() {
    if (!liveId || !isMod) return;
    await pinMessage(liveId, null);
    moderation.setPinned(null);
  }

  async function toggleComments(off: boolean) {
    if (!liveId || !isMod) return;
    const result = await setCommentsOff(liveId, off);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    moderation.setCommentsOffLocal(off);
    toast.success(off ? "Comments turned off" : "Comments turned on");
  }

  async function doUnmute(mute: LiveMute) {
    if (!liveId || !isMod) return;
    const result = await unmuteUser(liveId, mute.user_id);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await moderation.refresh();
  }

  /* ---------------------------------------------------------------------- */
  /*  Join-request actions                                                  */
  /* ---------------------------------------------------------------------- */

  async function askToJoin() {
    if (!userId) {
      openAuthDialog();
      return;
    }
    setJoinPrompt(false);
    const result = await myJoin.request();
    if (result.ok) toast.success("Request sent — waiting for the host");
    else toast.error(result.message);
  }

  async function acceptRequest(request: JoinRequest) {
    setBusyMod(true);
    const result = await respondToJoinRequest(request.id, true);
    setBusyMod(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await joinState.refresh();
    announce(`@${requestName(request)} joined the LIVE 🎉`);
  }

  async function rejectRequest(request: JoinRequest) {
    setBusyMod(true);
    const result = await respondToJoinRequest(request.id, false);
    setBusyMod(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    await joinState.refresh();
  }

  async function removeGuest(guest: LiveGuest) {
    if (!liveId) return;
    setBusyMod(true);
    await leaveGuestStage(liveId, guest.user_id);
    setBusyMod(false);
    await joinState.refresh();
  }

  async function leaveStage() {
    if (!liveId) return;
    await leaveGuestStage(liveId);
    localStream.current?.getTracks().forEach((track) => track.stop());
    localStream.current = null;
    setCameraReady(false);
    await myJoin.refresh();
  }

  /* ---------------------------------------------------------------------- */
  /*  TikTok-style chrome helpers                                           */
  /* ---------------------------------------------------------------------- */

  /** Know whether we already follow the host so the pill reads correctly. */
  useEffect(() => {
    let alive = true;
    if (mode !== "viewer" || !userId || !hostUsername || hostUsername === "host") {
      setFollowing(false);
      return;
    }
    void isFollowing(userId, hostUsername)
      .then((value) => {
        if (alive) setFollowing(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [mode, userId, hostUsername]);

  async function toggleFollow() {
    if (!userId) {
      openAuthDialog();
      return;
    }
    if (!hostUsername || hostUsername === "host" || followBusy) return;
    setFollowBusy(true);
    const result = following
      ? await unfollowUser({ followerId: userId, followingUsername: hostUsername })
      : await followUser({
          followerId: userId,
          followerUsername: username ?? "",
          followingUsername: hostUsername,
        });
    setFollowBusy(false);
    if (!result.ok) {
      toast.error(result.error ?? "Couldn't update follow");
      return;
    }
    setFollowing((value) => !value);
  }

  /** Heart button: float a few hearts up the screen, TikTok style. */
  function sendHearts() {
    const burst = Array.from({ length: 5 }, (_, index) => ({
      id: Date.now() + index,
      drift: (index - 2) * 14,
    }));
    setHearts((current) => [...current.slice(-24), ...burst]);
    window.setTimeout(() => {
      setHearts((current) => current.filter((heart) => !burst.some((b) => b.id === heart.id)));
    }, 2200);
  }

  async function shareLive() {
    const url =
      mode === "host"
        ? `${globalThis.location?.origin ?? ""}/live?host=${userId ?? ""}&name=${encodeURIComponent(username ?? "")}`
        : `${globalThis.location?.origin ?? ""}/live?host=${hostId ?? ""}&name=${encodeURIComponent(hostUsername)}`;
    const data = {
      title: `@${hostUsername} is LIVE on Coolerup`,
      text: `Watch @${hostUsername} live on Coolerup`,
      url,
    };
    try {
      if (navigator.share) {
        await navigator.share(data);
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success("LIVE link copied");
    } catch {
      // User dismissed the share sheet; nothing to do.
    }
  }

  /** X in the top-left: confirm before ending, just leave when watching. */
  function handleClose() {
    if (mode === "host" && broadcasting) {
      setEndConfirm(true);
      return;
    }
    finish();
  }

  /* ---------------------------------------------------------------------- */
  /*  Chat line                                                             */
  /* ---------------------------------------------------------------------- */

  /**
   * Floating TikTok-style comment: no box, just shadowed text over the video so
   * the host's face stays visible.
   */
  const renderChatLine = (message: ChatMessage) => {
    if (message.system) {
      return (
        <p
          key={message.id}
          className="w-fit max-w-full break-words rounded-full bg-black/35 px-2.5 py-0.5 text-[11px] font-semibold text-white/80 backdrop-blur-sm"
        >
          {message.body}
        </p>
      );
    }
    if (message.gift) {
      return (
        <p
          key={message.id}
          className="break-words text-[13px] font-extrabold leading-snug text-[#ffd166] drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]"
        >
          {message.body}
        </p>
      );
    }
    const mod = isModName(message.username, message.userId);
    return (
      <div
        key={message.id}
        className="break-words text-[13px] leading-snug text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]"
      >
        <button
          type="button"
          onClick={() => void openNameMenu(message)}
          className={`inline-flex items-center gap-0.5 font-extrabold ${
            mod ? "text-sky-300" : "text-white/75"
          }`}
        >
          {mod && <Shield className="h-3 w-3 shrink-0" />}@{message.username}
        </button>{" "}
        {message.body && <span className="font-medium">{message.body}</span>}
        {message.gif && (
          <>
            <img src={message.gif} alt="GIF" loading="lazy" className="mt-1 max-h-32 rounded-lg" />
            {message.gifCredit && (
              <span className="mt-0.5 block text-[9px] font-semibold text-white/70">
                Made by {message.gifCredit}
              </span>
            )}
          </>
        )}
      </div>
    );
  };

  const pinnedBar = moderation.pinned ? (
    <div className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100">
      <Pin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-300" />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-extrabold">@{moderation.pinned.username}:</span>{" "}
        {moderation.pinned.body}
      </p>
      {isMod && (
        <button
          type="button"
          onClick={() => void doUnpin()}
          aria-label="Unpin comment"
          className="shrink-0 text-amber-200/80"
        >
          <PinOff className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  ) : null;

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
        <DialogContent className="block h-[100dvh] w-screen max-w-none overflow-hidden border-0 bg-black p-0 text-white sm:h-[100dvh] sm:w-screen sm:max-w-none sm:rounded-none [&>button:last-child]:hidden">
          <DialogTitle className="sr-only">
            {mode === "viewer" ? "Watch live stream" : "Go live"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Live video broadcast and viewing.
          </DialogDescription>
          <div className="relative h-full w-full overflow-hidden bg-black">
            {/* Full-bleed video — no bars, no letterboxing, like the For You feed. */}
            {stageActive ? (
              <div className="absolute inset-0 px-1.5 pb-24 pt-[calc(env(safe-area-inset-top)+3.5rem)]">
                <LiveMultiGuest
                  liveId={liveId ?? ""}
                  selfId={userId ?? viewerToken.current}
                  selfName={username ?? "you"}
                  role={mode === "host" ? "host" : "guest"}
                  localStream={localStream.current}
                  guests={joinState.guests}
                  {...(mode === "host"
                    ? {
                        onRemoveGuest: (uid: string) => {
                          const guest = joinState.guests.find((row) => row.user_id === uid);
                          if (guest) void removeGuest(guest);
                        },
                      }
                    : {})}
                  {...(mode === "viewer" ? { onLeaveStage: () => void leaveStage() } : {})}
                />
              </div>
            ) : mode === "host" ? (
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
            {mode === "host" && !cameraReady && !stageActive && (
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
            {mode === "viewer" && !remoteStream && !stageActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-8 text-center">
                <Radio className="h-10 w-10 text-primary" />
                <p className="font-display text-2xl">
                  {ended ? "Stream ended" : `@${hostUsername} is live`}
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

            {/* ---------------------------------------------------------------- */}
            {/* TOP: X left · LIVE pill centre · chat + overflow right            */}
            {/* ---------------------------------------------------------------- */}
            <div className="absolute inset-x-0 top-0 z-30 grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3 pt-[max(0.6rem,env(safe-area-inset-top))]">
              <div className="flex justify-start">
                <button
                  onClick={handleClose}
                  aria-label={mode === "host" ? "End live stream" : "Close live stream"}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition active:scale-95"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="flex justify-center">
                {(mode === "host" && broadcasting) || mode === "viewer" ? (
                  <span className="flex items-center gap-1.5 rounded-full bg-[#FE2C55] px-3 py-1 text-[11px] font-extrabold tracking-wide text-white shadow-lg shadow-black/30">
                    <Circle className="h-2 w-2 fill-white" /> LIVE
                    <span className="ml-0.5 flex items-center gap-1 font-bold">
                      <Eye className="h-3.5 w-3.5" />
                      {viewers}
                    </span>
                  </span>
                ) : (
                  <span className="h-7" />
                )}
              </div>

              <div className="flex items-center justify-end gap-2">
                <button
                  onClick={() => {
                    setChatOpen((value) => !value);
                    setUnread(0);
                  }}
                  aria-label={chatOpen ? "Hide live chat" : "Show live chat"}
                  aria-pressed={chatOpen}
                  className="relative flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition active:scale-95"
                >
                  <MessageCircle className="h-5 w-5" />
                  {unread > 0 && !chatOpen && (
                    <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-extrabold">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </button>
                <button
                  onClick={() => setMenuOpen((value) => !value)}
                  aria-label="Live options"
                  aria-expanded={menuOpen}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition active:scale-95"
                >
                  <MoreVertical className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* Host bar, directly under the top row — left aligned like TikTok  */}
            {/* ---------------------------------------------------------------- */}
            <div className="absolute left-3 top-[calc(env(safe-area-inset-top)+3.25rem)] z-20 flex max-w-[72%] items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#2A2A2A] text-sm font-black uppercase text-white ring-2 ring-white">
                {(hostUsername[0] ?? "?").toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-bold text-white [text-shadow:0_1px_4px_rgba(0,0,0,0.85)]">
                  @{hostUsername}
                </p>
                {mode === "host" && <p className="text-[10px] font-semibold text-white/70">Host</p>}
              </div>
              {mode === "viewer" && (
                <button
                  type="button"
                  onClick={() => void toggleFollow()}
                  disabled={followBusy}
                  className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-extrabold transition active:scale-95 disabled:opacity-60 ${
                    following ? "bg-white text-black" : "bg-[#FE2C55] text-white"
                  }`}
                >
                  {following ? "Following" : "Follow"}
                </button>
              )}
            </div>

            {/* Top gifters, tucked under the top-right icons. */}
            {giftCoins > 0 && (
              <div className="pointer-events-none absolute right-3 top-[calc(env(safe-area-inset-top)+3.25rem)] z-20 flex flex-col items-end gap-1">
                <GiftLeaderboard rows={giftFeed} />
              </div>
            )}

            {/* "LIVE with @host + @guests" line when the stage is on */}
            {stageActive && (
              <div className="pointer-events-none absolute left-3 top-[calc(env(safe-area-inset-top)+5.5rem)] z-20">
                <span className="rounded-full bg-black/55 px-3 py-1 text-[11px] font-bold text-white/85 backdrop-blur">
                  {liveWithLine(hostUsername, joinState.guests)}
                </span>
              </div>
            )}

            {/* Host: incoming join banner */}
            {mode === "host" && broadcasting && joinState.pending.length > 0 && (
              <div className="absolute inset-x-0 top-[calc(env(safe-area-inset-top)+6rem)] z-20">
                <LiveJoinBanner
                  requests={joinState.pending}
                  busy={busyMod}
                  onAccept={(request) => void acceptRequest(request)}
                  onReject={(request) => void rejectRequest(request)}
                  onOpenAll={() => setJoinSheetOpen(true)}
                />
              </div>
            )}

            {/* Overflow menu: Guests / Mods / comments / dashboard / end live */}
            {menuOpen && (
              <>
                <button
                  type="button"
                  aria-label="Close live options"
                  onClick={() => setMenuOpen(false)}
                  className="absolute inset-0 z-30 bg-transparent"
                />
                <div className="absolute right-3 top-[calc(env(safe-area-inset-top)+3.5rem)] z-40 w-56 overflow-hidden rounded-2xl border border-white/10 bg-black/60 p-1.5 text-sm text-white shadow-2xl backdrop-blur-xl">
                  {mode === "host" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setJoinSheetOpen(true);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-white/10"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/50">
                        <Users className="h-4 w-4 text-white" />
                      </span>{" "}
                      Guests
                      {joinState.pending.length > 0 && (
                        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-[#FE2C55] px-1 text-[10px] font-extrabold">
                          {joinState.pending.length}
                        </span>
                      )}
                    </button>
                  ) : myJoin.status === "accepted" ? (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void leaveStage();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-white/10"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/50">
                        <UserPlus className="h-4 w-4 text-white" />
                      </span>{" "}
                      Leave stage
                    </button>
                  ) : myJoin.status === "pending" ? (
                    <div className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-semibold text-white/60">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/50">
                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                      </span>{" "}
                      Request sent
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        if (userId) setJoinPrompt(true);
                        else openAuthDialog();
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-white/10"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/50">
                        <UserPlus className="h-4 w-4 text-white" />
                      </span>{" "}
                      Request to join LIVE
                    </button>
                  )}

                  {(isHost || isMod) && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setModOpen(true);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-white/10"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/50">
                        <ShieldCheck className="h-4 w-4 text-white" />
                      </span>{" "}
                      Mods
                      {moderation.mods.length > 0 && (
                        <span className="ml-auto text-xs text-white/60">
                          {moderation.mods.length}
                        </span>
                      )}
                    </button>
                  )}

                  {(isHost || isMod) && (
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        void toggleComments(!moderation.commentsOff);
                      }}
                      className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left font-semibold hover:bg-white/10"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-black/50">
                        <MessageSquareOff className="h-4 w-4 text-white" />
                      </span>
                      {moderation.commentsOff ? "Turn comments on" : "Turn comments off"}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      if (mode === "host") setEndConfirm(true);
                      else finish();
                    }}
                    className="mt-1 flex w-full items-center gap-2.5 rounded-xl bg-[#FE2C55]/15 px-3 py-2.5 text-left font-extrabold text-[#FE2C55] hover:bg-[#FE2C55]/25"
                  >
                    <X className="h-4 w-4" /> {mode === "host" ? "End live" : "Leave live"}
                  </button>
                </div>
              </>
            )}

            {/* ---------------------------------------------------------------- */}
            {/* BOTTOM: floating chat + one control row, TikTok style            */}
            {/* ---------------------------------------------------------------- */}
            <div className="absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {/* Floating hearts from the heart button */}
              <div className="pointer-events-none absolute bottom-14 right-3 h-56 w-20 overflow-visible">
                {hearts.map((heart) => (
                  <Heart
                    key={heart.id}
                    className="live-heart absolute bottom-0 h-6 w-6 fill-[#FE2C55] text-[#FE2C55]"
                    style={{ left: `${36 + heart.drift}px` }}
                  />
                ))}
              </div>

              {mode === "viewer" && myJoin.status === "accepted" && (
                <div className="mb-2 flex w-fit items-center gap-2 rounded-full bg-emerald-500/25 px-3 py-1 text-[11px] font-bold text-emerald-100 backdrop-blur">
                  <UserPlus className="h-3.5 w-3.5" /> You're on LIVE
                  <button
                    type="button"
                    onClick={() => void leaveStage()}
                    className="rounded-full bg-white/20 px-2 py-0.5 text-white"
                  >
                    Leave
                  </button>
                </div>
              )}

              {mode === "viewer" && myJoin.status === "rejected" && (
                <p className="mb-2 w-fit rounded-full bg-black/50 px-3 py-1 text-[11px] font-semibold text-white/70 backdrop-blur">
                  {JOIN_STATUS_COPY.rejected}
                </p>
              )}

              {/* Chat floats over the video, bottom-left, no box. */}
              {(mode === "viewer" || broadcasting) && chatOpen && (
                <div className="mb-2 max-h-[34vh] w-[82%] space-y-1.5 overflow-y-auto overscroll-contain pr-2 [mask-image:linear-gradient(to_bottom,transparent,black_14%)] [scrollbar-width:none]">
                  {pinnedBar}
                  <GiftTicker rows={tickerRows} />
                  {messages.length === 0 ? (
                    <p className="text-xs font-medium text-white/70 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]">
                      {mode === "viewer"
                        ? "Be the first to say hi."
                        : "Live chat will appear here."}
                    </p>
                  ) : (
                    messages.map(renderChatLine)
                  )}
                  <div ref={chatEnd} />
                </div>
              )}

              {mode === "viewer" || broadcasting ? (
                <>
                  {showGifPicker && (
                    <GifPicker
                      className="mb-2 rounded-xl border-white/10 bg-black/70 text-white"
                      onPick={(url, meta) => {
                        setDraftGif(url);
                        setDraftGifCredit(meta?.username ? `@${meta.username}` : null);
                        setShowGifPicker(false);
                      }}
                      onClose={() => setShowGifPicker(false)}
                    />
                  )}
                  {draftGif && (
                    <div className="relative mb-2 inline-block">
                      <img src={draftGif} alt="Selected GIF" className="max-h-24 rounded-lg" />
                      <button
                        type="button"
                        onClick={() => {
                          setDraftGif(null);
                          setDraftGifCredit(null);
                        }}
                        aria-label="Remove GIF"
                        className="absolute right-1 top-1 rounded-full bg-black/70 p-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      sendChat();
                    }}
                    className="flex items-center gap-2"
                  >
                    {moderation.commentsOff && !isMod ? (
                      <p className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/20 px-4 text-xs font-semibold text-white/80 backdrop-blur-md">
                        <MessageSquareOff className="h-3.5 w-3.5" /> Comments are off
                      </p>
                    ) : (
                      <div className="relative min-w-0 flex-1">
                        <input
                          value={draft}
                          onChange={(event) => setDraft(event.target.value.slice(0, 240))}
                          placeholder="Say something…"
                          aria-label="Chat message"
                          className="h-10 w-full rounded-full border border-white/20 bg-white/20 pl-4 pr-11 text-sm text-white outline-none backdrop-blur-md placeholder:text-white/80"
                        />
                        <button
                          type="button"
                          onClick={() => setShowGifPicker((v) => !v)}
                          aria-label="Add a GIF"
                          aria-pressed={showGifPicker}
                          className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-black text-white/85 transition active:scale-90"
                        >
                          GIF
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => (userId ? setGiftOpen(true) : openAuthDialog())}
                      aria-label="Send a gift"
                      className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition active:scale-90"
                    >
                      <Gift className="h-5 w-5" />
                      {wallet.balance != null && wallet.balance > 0 && (
                        <span className="absolute -right-1 -top-1 rounded-full bg-yellow-400 px-1 text-[9px] font-extrabold leading-4 text-black">
                          {wallet.balance > 999 ? "999+" : wallet.balance}
                        </span>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={sendHearts}
                      aria-label="Send a heart"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition active:scale-90"
                    >
                      <Heart className="h-5 w-5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => void shareLive()}
                      aria-label="Share live stream"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-md transition active:scale-90"
                    >
                      <Share2 className="h-5 w-5" />
                    </button>
                  </form>
                </>
              ) : (
                /* Setup sheet — the only place the topic input appears. */
                <div className="space-y-2 rounded-3xl border border-white/10 bg-black/70 p-3 backdrop-blur-xl">
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value.slice(0, 80))}
                    placeholder="What are you going live about?"
                    className="w-full rounded-full bg-[#1A1A1A] px-4 py-3 text-base text-white outline-none placeholder:text-white/50"
                  />
                  <button
                    onClick={() => void startBroadcast()}
                    disabled={!cameraReady || Boolean(cameraError)}
                    className="w-full rounded-full bg-[#FE2C55] py-3.5 font-extrabold text-white disabled:opacity-50"
                  >
                    {cameraReady ? "Start live stream" : "Camera required"}
                  </button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* X on a live broadcast asks first, TikTok style. */}
      <Dialog open={endConfirm} onOpenChange={setEndConfirm}>
        <DialogContent className="max-w-xs rounded-2xl border-0 bg-white p-6 text-black">
          <DialogTitle className="text-lg font-extrabold text-black">End live?</DialogTitle>
          <DialogDescription className="text-sm text-neutral-600">
            Your viewers will be disconnected and this broadcast will finish.
          </DialogDescription>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => setEndConfirm(false)}
              className="flex-1 rounded-full bg-[#E5E5E5] py-2.5 text-sm font-bold text-black"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setEndConfirm(false);
                finish();
              }}
              className="flex-1 rounded-full bg-[#FE2C55] py-2.5 text-sm font-extrabold text-white"
            >
              End live
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Host: moderators sheet */}
      <LiveModPanel
        open={modOpen}
        onOpenChange={setModOpen}
        hostHandle={username ?? ""}
        mods={moderation.mods}
        mutes={moderation.mutes}
        commentsOff={moderation.commentsOff}
        loading={moderation.loading}
        busy={busyMod}
        onAdd={(row) => void doAddMod(row.id, row.handle)}
        onRemove={(mod) => void doRemoveMod(mod)}
        onUnmute={(mute) => void doUnmute(mute)}
        onToggleComments={(off) => void toggleComments(off)}
      />

      {/* Host: join requests sheet */}
      <LiveJoinRequestSheet
        open={joinSheetOpen}
        onOpenChange={setJoinSheetOpen}
        requests={joinState.pending}
        guests={joinState.guests}
        busy={busyMod}
        onAccept={(request) => void acceptRequest(request)}
        onReject={(request) => void rejectRequest(request)}
        onRemoveGuest={(guest) => void removeGuest(guest)}
      />

      {/* Viewer: "Request to join?" confirm */}
      <Dialog open={joinPrompt} onOpenChange={setJoinPrompt}>
        <DialogContent className="max-w-xs rounded-3xl border-white/10 bg-zinc-950 p-6 text-white">
          <DialogTitle className="text-lg font-extrabold">Request to join?</DialogTitle>
          <DialogDescription className="text-sm text-zinc-400">
            The host will see your request and can bring you on screen. Your camera and mic turn on
            only if they accept.
          </DialogDescription>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => setJoinPrompt(false)}
              className="flex-1 rounded-full bg-white/10 py-2.5 text-sm font-bold"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void askToJoin()}
              className="flex-1 rounded-full bg-[#fe2c55] py-2.5 text-sm font-extrabold"
            >
              Request
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Moderation menu for a tapped chat name */}
      <Dialog open={nameMenu !== null} onOpenChange={(next) => !next && setNameMenu(null)}>
        <DialogContent className="max-w-xs rounded-3xl border-white/10 bg-zinc-950 p-5 text-white">
          <DialogTitle className="text-base font-extrabold">
            @{nameMenu?.username ?? ""}
          </DialogTitle>
          <DialogDescription className="text-xs text-zinc-400">
            {isMod ? "Moderate this viewer." : "Viewer actions."}
          </DialogDescription>

          {!isMod ? (
            <p className="mt-4 rounded-xl bg-white/5 px-3 py-3 text-xs text-white/60">
              Only the host or a moderator can take action on chat.
            </p>
          ) : !nameMenu?.userId ? (
            <p className="mt-4 rounded-xl bg-white/5 px-3 py-3 text-xs text-white/60">
              Couldn't find this viewer's profile.
            </p>
          ) : (
            <div className="mt-4 space-y-2">
              {isHost && (
                <button
                  type="button"
                  disabled={busyMod || isModName(nameMenu.username, nameMenu.userId)}
                  onClick={() => void doAddMod(nameMenu.userId!, nameMenu.username)}
                  className="flex w-full items-center gap-2 rounded-full bg-sky-500/15 px-4 py-2.5 text-sm font-bold text-sky-200 disabled:opacity-40"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {isModName(nameMenu.username, nameMenu.userId)
                    ? "Already a moderator"
                    : "Add as Moderator"}
                </button>
              )}
              {nameMenu.message && (
                <button
                  type="button"
                  onClick={() => void doPin(nameMenu.message!)}
                  className="flex w-full items-center gap-2 rounded-full bg-amber-400/15 px-4 py-2.5 text-sm font-bold text-amber-200"
                >
                  <Pin className="h-4 w-4" /> Pin comment
                </button>
              )}
              <p className="pt-1 text-[11px] font-extrabold uppercase tracking-wide text-white/40">
                Mute
              </p>
              <div className="flex gap-2">
                {MUTE_OPTIONS.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    disabled={busyMod}
                    onClick={() => void doMute(nameMenu.userId!, nameMenu.username, option.minutes)}
                    className="flex-1 rounded-full bg-white/10 px-2 py-2 text-[11px] font-bold text-white/80 disabled:opacity-40"
                  >
                    {option.minutes ? `${option.minutes} min` : "Permanent"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                disabled={busyMod}
                onClick={() => void doBlock(nameMenu.userId!, nameMenu.username)}
                className="flex w-full items-center justify-center gap-2 rounded-full bg-rose-600/90 px-4 py-2.5 text-sm font-extrabold text-white disabled:opacity-40"
              >
                <X className="h-4 w-4" /> Block & remove
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <LiveGiftPanel
        open={giftOpen}
        onOpenChange={setGiftOpen}
        christmas={christmas}
        balance={wallet.balance}
        signedIn={Boolean(userId)}
        sending={sendingGift}
        streamCoins={giftCoins}
        streamEarnings={earningsFromCoins(giftCoins).usd}
        onSend={(gift, quantity) => void sendGift(gift, quantity)}
        onRecharge={() => {
          setGiftOpen(false);
          setCoinOpen(true);
        }}
        onSignIn={() => {
          setGiftOpen(false);
          openAuthDialog();
        }}
        {...(mode === "host"
          ? {
              onOpenDashboard: () => {
                setGiftOpen(false);
                finish();
                void navigate({ to: "/live/dashboard" });
              },
            }
          : {})}
      />

      <LiveCoinSheet
        open={coinOpen}
        onOpenChange={setCoinOpen}
        balance={wallet.balance}
        signedIn={Boolean(userId)}
        onOrderCreated={openVenmoForOrder}
        onSignIn={() => {
          setCoinOpen(false);
          openAuthDialog();
        }}
      />

      <CoinVenmoSheet
        order={activeOrder}
        open={venmoOpen}
        onOpenChange={(next) => {
          setVenmoOpen(next);
          if (!next) setActiveOrder(null);
        }}
        onSubmitted={() => {
          toast.success("Payment sent \u2014 we're matching it now");
        }}
      />
    </>
  );
}
