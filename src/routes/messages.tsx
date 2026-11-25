import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  EyeOff,
  Film,
  Lock,
  Phone,
  Play,
  Plus,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCall } from "@/lib/calls";
import { Button } from "@/components/ui/button";
import { notifyUser } from "@/lib/notify";
import { GifPicker } from "@/components/GifPicker";
import { OnlineDot, OnlineStatusSubtitle } from "@/components/OnlineStatusBadge";
import { normalizePresenceHandle, useOnlineStatuses } from "@/lib/onlineStatus";
import { DmAttachmentSheet } from "@/components/DmAttachmentSheet";
import { DmMediaLightbox, type LightboxMediaItem } from "@/components/DmMediaLightbox";
import { DmMediaActionSheet } from "@/components/DmMediaActionSheet";
import {
  checkDmMediaPermission,
  fetchDirectMessages,
  isImageMediaFile,
  isViewOnceExpired,
  openViewOnceMedia,
  resolveDmMediaUrl,
  sendDirectMessage,
  uploadDmMediaFile,
  type CoolerupVideoChoice,
  type DirectMessage,
  type DmMediaPermission,
} from "@/lib/dmMedia";

export const Route = createFileRoute("/messages")({
  head: () => ({
    meta: [
      { title: "Messages — Coolerup" },
      { name: "description", content: "Chat with creators on Coolerup." },
      { property: "og:title", content: "Messages — Coolerup" },
      { property: "og:description", content: "Chat with creators on Coolerup." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Messages,
});

const LONG_PRESS_MS = 450;

function formatInboxPreview(last: DirectMessage): string {
  if (last.message) return last.message;
  if (last.view_once) {
    return isViewOnceExpired(last) ? "Opened media" : "View once media";
  }
  if (last.media_type === "image") return "Photo";
  if (last.media_type === "video") return "Video";
  if (last.media_type === "coolerup_video") return "Coolerup Video";
  if (last.gif_url) return "GIF";
  return "";
}

function Messages() {
  const auth = useAuth();
  const { startCall } = useCall();
  const me = auth.handle;

  const [toUser, setToUser] = useState("");
  const [text, setText] = useState("");
  const [msgs, setMsgs] = useState<DirectMessage[]>([]);
  const [resolvedUrls, setResolvedUrls] = useState<Record<string, string>>({});

  // Attachment & draft states
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showGifs, setShowGifs] = useState(false);
  const [viewOnceDraft, setViewOnceDraft] = useState(false);
  const [draftGif, setDraftGif] = useState<string | null>(null);
  const [draftGifCredit, setDraftGifCredit] = useState<string | null>(null);
  const [draftFile, setDraftFile] = useState<File | null>(null);
  const [draftFilePreview, setDraftFilePreview] = useState<string | null>(null);
  const [draftCoolerupVideo, setDraftCoolerupVideo] = useState<CoolerupVideoChoice | null>(null);
  const [sending, setSending] = useState(false);

  // Media privacy permission for current conversation
  const [mediaPermission, setMediaPermission] = useState<DmMediaPermission | null>(null);

  // Fullscreen swipeable viewer
  const [lightboxState, setLightboxState] = useState<{
    items: LightboxMediaItem[];
    initialIndex: number;
  } | null>(null);

  // Long-press action sheet
  const [actionTarget, setActionTarget] = useState<DirectMessage | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);

  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const u = new URLSearchParams(window.location.search).get("user");
    if (u) setToUser(u);
  }, []);

  const load = useCallback(async () => {
    const rows = await fetchDirectMessages();
    setMsgs(rows);
  }, []);

  const userId = auth.user?.id;
  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  // Keep conversation updated in realtime (new media, view-once updates, deletes)
  useEffect(() => {
    if (!auth.user?.id) return;
    const ch = supabase
      .channel(`dm-thread:${auth.user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "direct_messages" }, () => {
        void load();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
  }, [auth.user?.id, load]);

  // Clean up object URL for picked local file preview
  useEffect(() => {
    if (!draftFile) {
      setDraftFilePreview(null);
      return;
    }
    const url = URL.createObjectURL(draftFile);
    setDraftFilePreview(url);
    return () => URL.revokeObjectURL(url);
  }, [draftFile]);

  // Resolve signed URLs for visible conversation media (non-View-Once)
  const cleanTo = toUser.trim().replace(/^@+/, "").toLowerCase();
  const cleanMe = (me ?? "").trim().replace(/^@+/, "").toLowerCase();

  const convo = useMemo(
    () =>
      msgs.filter((m) => {
        const from = m.from_username.toLowerCase();
        const to = m.to_username.toLowerCase();
        return from === cleanTo || to === cleanTo;
      }),
    [msgs, cleanTo],
  );

  useEffect(() => {
    let active = true;
    const toResolve = convo.filter((m) => m.media_url && !m.view_once && !resolvedUrls[m.id]);
    if (toResolve.length === 0) return;

    void Promise.all(
      toResolve.map(async (m) => {
        const url = await resolveDmMediaUrl(m.media_url);
        return [m.id, url] as const;
      }),
    ).then((pairs) => {
      if (!active) return;
      setResolvedUrls((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [id, url] of pairs) {
          if (url && next[id] !== url) {
            next[id] = url;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    });

    return () => {
      active = false;
    };
  }, [convo, resolvedUrls]);

  // Check mutual-follow / "Allow messages from everyone" whenever conversation target changes
  useEffect(() => {
    if (!auth.user?.id || !cleanMe || !cleanTo) {
      setMediaPermission(null);
      return;
    }
    let active = true;
    const t = window.setTimeout(() => {
      void checkDmMediaPermission({
        myUserId: auth.user?.id,
        myHandle: cleanMe,
        targetHandle: cleanTo,
      }).then((perm) => {
        if (active) setMediaPermission(perm);
      });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(t);
    };
  }, [auth.user?.id, cleanMe, cleanTo]);

  useEffect(() => {
    endRef.current?.scrollIntoView();
  }, [convo.length, toUser]);

  const clearDraftMedia = () => {
    setDraftGif(null);
    setDraftGifCredit(null);
    setDraftFile(null);
    setDraftCoolerupVideo(null);
    setViewOnceDraft(false);
  };

  const send = async () => {
    const body = text.trim();
    const to = cleanTo;
    const hasDraft = Boolean(body || draftGif || draftFile || draftCoolerupVideo);
    if (!hasDraft || !to || !auth.user || !me || sending) return;

    setSending(true);
    try {
      let mediaUrl: string | null = null;
      let mediaType: DirectMessage["media_type"] = null;
      let mediaVideoId: string | null = null;
      let mediaCaption: string | null = null;
      let mediaHasExternalWatermark = false;

      if (draftFile || draftCoolerupVideo) {
        const perm =
          mediaPermission ??
          (await checkDmMediaPermission({
            myUserId: auth.user.id,
            myHandle: me,
            targetHandle: to,
          }));
        if (!perm.allowed) {
          toast.error(
            perm.reason ||
              "Only mutual followers can send pics & videos unless this user has 'Allow messages from everyone' on in Settings.",
          );
          return;
        }
      }

      if (draftFile) {
        const uploaded = await uploadDmMediaFile({
          userId: auth.user.id,
          username: me,
          file: draftFile,
        });
        mediaUrl = uploaded.url;
        mediaType = uploaded.mediaType;
        mediaHasExternalWatermark = uploaded.hasExternalWatermark;
      } else if (draftCoolerupVideo) {
        mediaUrl = draftCoolerupVideo.video_url;
        mediaType = "coolerup_video";
        mediaVideoId = draftCoolerupVideo.id;
        mediaCaption = draftCoolerupVideo.caption || `Video by @${draftCoolerupVideo.username}`;
        mediaHasExternalWatermark = Boolean(draftCoolerupVideo.has_external_watermark);
      }

      const res = await sendDirectMessage({
        fromId: auth.user.id,
        fromUsername: me,
        toUsername: to,
        message: body,
        gifUrl: draftGif,
        gifCredit: draftGifCredit,
        mediaUrl,
        mediaType,
        mediaVideoId,
        mediaCaption,
        mediaHasExternalWatermark,
        viewOnce: Boolean(mediaUrl && viewOnceDraft),
      });

      if (!res.ok) {
        toast.error(res.error || "Couldn't send message");
        return;
      }

      setText("");
      clearDraftMedia();
      setShowGifs(false);
      setShowAttachMenu(false);
      if (res.row) {
        setMsgs((prev) => [...prev, res.row!]);
      } else {
        await load();
      }

      const notifyPreview = mediaUrl
        ? viewOnceDraft
          ? "sent a View Once photo/video"
          : mediaType === "coolerup_video"
            ? "shared a Coolerup video"
            : mediaType === "video"
              ? "sent a video"
              : "sent a photo"
        : body.slice(0, 80) || "sent a GIF";

      const { data: targetRow } = await supabase
        .from("profiles")
        .select("id")
        .ilike("handle", to)
        .maybeSingle();

      if (targetRow?.id) {
        void notifyUser({
          targetUserId: targetRow.id,
          actorUserId: auth.user.id,
          type: "message",
          text: `${me}: ${notifyPreview}`,
          url: `/messages?user=${encodeURIComponent(me)}`,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send media");
    } finally {
      setSending(false);
    }
  };

  const placeCall = async (withVideo: boolean) => {
    const handle = cleanTo;
    const { data: target } = await supabase
      .from("profiles")
      .select("id")
      .ilike("handle", handle)
      .maybeSingle();
    if (!target) {
      toast.error(`@${handle} hasn't joined Coolerup yet`);
      return;
    }
    void startCall(handle, target.id, withVideo);
  };

  // Non-View-Once pics & videos in this thread for full-screen swipe navigation
  const galleryItems = useMemo<LightboxMediaItem[]>(() => {
    return convo
      .filter((m) => Boolean(m.media_url) && !m.view_once && Boolean(resolvedUrls[m.id]))
      .map((m) => ({
        id: m.id,
        url: resolvedUrls[m.id]!,
        mediaType: m.media_type ?? "image",
        fromUsername: m.from_username,
        caption: m.media_caption || m.message || null,
        viewOnce: false,
        msg: m,
      }));
  }, [convo, resolvedUrls]);

  const handleOpenMediaBubble = async (m: DirectMessage) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }

    if (m.view_once) {
      if (isViewOnceExpired(m)) {
        toast("Already opened — media has disappeared");
        return;
      }
      const res = await openViewOnceMedia({ msg: m, myHandle: me ?? "" });
      if (!res.ok || !res.resolvedUrl) {
        if (res.expired) {
          setMsgs((prev) =>
            prev.map((row) =>
              row.id === m.id
                ? {
                    ...row,
                    media_url: null,
                    view_once_opened_at: new Date().toISOString(),
                  }
                : row,
            ),
          );
        }
        toast(res.error || "Cannot open View Once media");
        return;
      }

      // Immediately update local state so View Once vanishes after closing
      setMsgs((prev) =>
        prev.map((row) =>
          row.id === m.id
            ? {
                ...row,
                media_url: null,
                view_once_opened_at: new Date().toISOString(),
              }
            : row,
        ),
      );

      setLightboxState({
        items: [
          {
            id: m.id,
            url: res.resolvedUrl,
            mediaType: res.mediaType ?? m.media_type ?? "image",
            fromUsername: m.from_username,
            caption: m.media_caption || m.message || null,
            viewOnce: true,
            msg: m,
          },
        ],
        initialIndex: 0,
      });
      return;
    }

    const idx = galleryItems.findIndex((item) => item.id === m.id);
    if (idx !== -1) {
      setLightboxState({ items: galleryItems, initialIndex: idx });
      return;
    }

    const resolved = resolvedUrls[m.id] || (await resolveDmMediaUrl(m.media_url));
    if (!resolved) {
      toast.error("Couldn't load media");
      return;
    }
    setResolvedUrls((prev) => ({ ...prev, [m.id]: resolved }));
    setLightboxState({
      items: [
        {
          id: m.id,
          url: resolved,
          mediaType: m.media_type ?? "image",
          fromUsername: m.from_username,
          caption: m.media_caption || m.message || null,
          viewOnce: false,
          msg: m,
        },
      ],
      initialIndex: 0,
    });
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const startLongPress = (m: DirectMessage) => {
    cancelLongPress();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      setActionTarget(m);
    }, LONG_PRESS_MS);
  };

  const inbox = new Map<string, DirectMessage>();
  msgs.forEach((m) =>
    inbox.set(m.from_username.toLowerCase() === cleanMe ? m.to_username : m.from_username, m),
  );
  const recentRecipients = useMemo(() => {
    const map = new Set<string>();
    for (const m of msgs) {
      const other = m.from_username.toLowerCase() === cleanMe ? m.to_username : m.from_username;
      if (other && other.toLowerCase() !== cleanTo) map.add(other);
    }
    return Array.from(map);
  }, [msgs, cleanMe, cleanTo]);

  const trackedHandles = useMemo(() => {
    const set = new Set<string>();
    for (const m of msgs) {
      const other = m.from_username.toLowerCase() === cleanMe ? m.to_username : m.from_username;
      const n = normalizePresenceHandle(other);
      if (n) set.add(n);
    }
    const active = normalizePresenceHandle(toUser);
    if (active) set.add(active);
    return Array.from(set);
  }, [msgs, cleanMe, toUser]);

  const presenceByHandle = useOnlineStatuses(trackedHandles);
  const activePresence = presenceByHandle[normalizePresenceHandle(toUser)] ?? {
    visible: false,
    isOnline: false,
    statusText: null,
  };

  if (auth.ready && !auth.user) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-black p-6 text-center text-white">
        <p className="font-display text-2xl">Your messages</p>
        <p className="text-white/60">Sign in to send and read private messages.</p>
        <Button onClick={auth.signIn}>Sign in</Button>
        <Link to="/" className="text-sm text-white/60">
          Back to Coolerup
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-black text-white pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]">
      <div className="border-b border-white/15 p-4">
        <div className="flex items-center gap-3">
          <Link to="/" aria-label="Back to Coolerup" className="text-white/70 hover:text-white">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="font-display text-xl text-white">Messages</h1>
        </div>
        <input
          value={toUser}
          onChange={(e) => setToUser(e.target.value)}
          placeholder="Message @username"
          className="mt-3 w-full rounded-full border border-white/15 bg-zinc-900 px-4 py-2 text-sm text-white placeholder:text-white/40 outline-none focus:border-primary"
        />
      </div>

      {toUser === "" ? (
        <div className="flex-1 overflow-y-auto p-2">
          <p className="px-3 py-2 text-xs font-bold tracking-widest text-white/50">INBOX</p>
          {inbox.size === 0 ? (
            <p className="mt-20 text-center text-white/50">No messages yet</p>
          ) : (
            [...inbox.entries()].reverse().map(([user, last]) => {
              const st = presenceByHandle[normalizePresenceHandle(user)] ?? {
                visible: false,
                isOnline: false,
                statusText: null,
              };
              return (
                <button
                  key={user}
                  onClick={() => setToUser(user)}
                  className="flex w-full items-center gap-3 rounded-xl p-3 text-left hover:bg-zinc-900"
                >
                  <div className="relative shrink-0">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary font-display uppercase text-primary-foreground">
                      {user[0]}
                    </div>
                    <OnlineDot
                      visible={st.visible && st.isOnline}
                      size="md"
                      className="absolute bottom-0 right-0"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-white">@{user}</p>
                    {st.visible && !st.isOnline && st.statusText && (
                      <OnlineStatusSubtitle status={st} className="block truncate" />
                    )}
                    <p className="truncate text-xs text-white/60">{formatInboxPreview(last)}</p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 border-b border-white/15 p-3">
            <button onClick={() => setToUser("")} className="text-sm font-bold text-primary">
              ← Inbox
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-bold text-white">@{toUser}</span>
                <OnlineDot
                  visible={activePresence.visible && activePresence.isOnline}
                  size="sm"
                  className="border-0"
                />
              </div>
              {activePresence.visible && !activePresence.isOnline && activePresence.statusText && (
                <OnlineStatusSubtitle status={activePresence} className="block truncate" />
              )}
            </div>
            <button
              onClick={() => placeCall(true)}
              className="ml-auto rounded-full p-2 text-white/70 hover:bg-zinc-900 hover:text-white"
              aria-label={`Video call @${toUser}`}
            >
              <VideoIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => placeCall(false)}
              className="rounded-full p-2 text-white/70 hover:bg-zinc-900 hover:text-white"
              aria-label={`Voice call @${toUser}`}
            >
              <Phone className="h-5 w-5" />
            </button>
          </div>

          {mediaPermission && !mediaPermission.allowed && (
            <div className="flex items-center gap-2 border-b border-white/10 bg-zinc-950 px-3 py-2 text-xs text-white/70">
              <Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" />
              <span>{mediaPermission.reason}</span>
            </div>
          )}

          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {convo.map((m) => {
              const isMine = m.from_username.toLowerCase() === cleanMe;
              const isCallLine =
                m.message.startsWith("📞 ") && !m.gif_url && !m.media_url && !m.view_once;

              if (isCallLine) {
                return (
                  <div
                    key={m.id}
                    className="mx-auto bg-transparent text-center text-xs italic text-white/50"
                  >
                    {m.message}
                  </div>
                );
              }

              const hasMediaBubble = Boolean(m.media_url || m.view_once);
              const viewOnceExpired = isViewOnceExpired(m);
              const mediaUrl = resolvedUrls[m.id];
              const isVideoBubble = m.media_type === "video" || m.media_type === "coolerup_video";

              return (
                <div
                  key={m.id}
                  onTouchStart={() => {
                    if (hasMediaBubble || m.gif_url) startLongPress(m);
                  }}
                  onTouchEnd={cancelLongPress}
                  onTouchMove={cancelLongPress}
                  onTouchCancel={cancelLongPress}
                  onMouseDown={() => {
                    if (hasMediaBubble || m.gif_url) startLongPress(m);
                  }}
                  onMouseUp={cancelLongPress}
                  onMouseLeave={cancelLongPress}
                  onContextMenu={(e) => {
                    if (hasMediaBubble || m.gif_url) {
                      e.preventDefault();
                      cancelLongPress();
                      setActionTarget(m);
                    }
                  }}
                  className={`max-w-[78%] rounded-2xl text-sm select-none ${
                    isMine
                      ? "ml-auto bg-theme-detail text-primary-foreground"
                      : "border border-white/15 bg-card text-white"
                  } ${hasMediaBubble ? "overflow-hidden p-1.5" : "px-3 py-2"}`}
                >
                  {hasMediaBubble && (
                    <button
                      type="button"
                      onClick={() => void handleOpenMediaBubble(m)}
                      aria-label={
                        m.view_once
                          ? viewOnceExpired
                            ? "Opened View Once media"
                            : "Open View Once media"
                          : `Open ${isVideoBubble ? "video" : "photo"} full screen`
                      }
                      className="block w-full text-left"
                    >
                      {m.view_once ? (
                        <div className="flex w-60 items-center gap-3 rounded-xl bg-black/35 px-3.5 py-4 sm:w-64">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15">
                            <EyeOff className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-bold">
                              {viewOnceExpired
                                ? "Opened"
                                : isVideoBubble
                                  ? "View Once Video"
                                  : "View Once Photo"}
                            </p>
                            <p className="text-xs opacity-80">
                              {viewOnceExpired
                                ? "Media disappeared"
                                : isMine
                                  ? "Sent · Disappears after 1 view"
                                  : "Tap to view once"}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="relative w-60 overflow-hidden rounded-xl bg-black sm:w-64">
                          {mediaUrl ? (
                            isVideoBubble ? (
                              <>
                                <video
                                  src={`${mediaUrl}#t=0.2`}
                                  muted
                                  playsInline
                                  preload="metadata"
                                  className="aspect-[4/5] w-full object-cover"
                                />
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/25">
                                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-black/75 text-white">
                                    <Play className="ml-0.5 h-6 w-6 fill-white" />
                                  </span>
                                </span>
                                {m.media_type === "coolerup_video" && (
                                  <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/75 px-2.5 py-1 text-[11px] font-semibold text-white">
                                    <Film className="h-3 w-3" />
                                    Coolerup Video
                                  </span>
                                )}
                              </>
                            ) : (
                              <img
                                src={mediaUrl}
                                alt={m.media_caption || "Chat photo"}
                                loading="lazy"
                                className="max-h-80 w-full object-cover"
                              />
                            )
                          ) : (
                            <div className="aspect-[4/5] w-full animate-pulse bg-zinc-800" />
                          )}
                        </div>
                      )}
                    </button>
                  )}

                  {(m.message || m.media_caption) && (
                    <p className={hasMediaBubble ? "px-2 pb-1 pt-1.5" : ""}>
                      {m.message || m.media_caption}
                    </p>
                  )}

                  {m.gif_url && (
                    <div className={m.message ? "mt-1.5" : ""}>
                      <img
                        src={m.gif_url}
                        alt="GIF"
                        loading="lazy"
                        className="max-h-52 rounded-xl"
                      />
                      {m.gif_credit && (
                        <p className="mt-0.5 text-[10px] font-semibold opacity-70">
                          Made by {m.gif_credit}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={endRef} />
          </div>

          {showGifs && (
            <GifPicker
              className="border-t border-white/15"
              onPick={(url, meta) => {
                setDraftGif(url);
                setDraftGifCredit(meta?.username ? `@${meta.username}` : null);
                setDraftFile(null);
                setDraftCoolerupVideo(null);
                setShowGifs(false);
              }}
              onClose={() => setShowGifs(false)}
            />
          )}

          {/* Draft Preview Strip with View Once Toggle */}
          {(draftGif || draftFile || draftCoolerupVideo) && (
            <div className="flex items-center justify-between gap-3 border-t border-white/15 bg-zinc-950 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2.5">
                {draftGif && (
                  <img
                    src={draftGif}
                    alt="Selected GIF"
                    className="h-14 w-14 rounded-lg object-cover"
                  />
                )}
                {draftFile &&
                  draftFilePreview &&
                  (isImageMediaFile(draftFile) ? (
                    <img
                      src={draftFilePreview}
                      alt="Selected photo"
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                  ) : (
                    <video
                      src={draftFilePreview}
                      muted
                      playsInline
                      className="h-14 w-14 rounded-lg object-cover"
                    />
                  ))}
                {draftCoolerupVideo && (
                  <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-primary/20 text-primary">
                    <Film className="h-6 w-6" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="truncate text-xs font-bold text-white">
                    {draftFile
                      ? draftFile.name
                      : draftCoolerupVideo
                        ? `Coolerup Video · @${draftCoolerupVideo.username}`
                        : "Selected GIF"}
                  </p>
                  {(draftFile || draftCoolerupVideo) && (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={viewOnceDraft}
                      onClick={() => setViewOnceDraft((v) => !v)}
                      className={`mt-1 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                        viewOnceDraft
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-white/20 bg-zinc-900 text-white/80"
                      }`}
                    >
                      <EyeOff className="h-3 w-3" />
                      <span>View Once {viewOnceDraft ? "ON" : "OFF"}</span>
                    </button>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={clearDraftMedia}
                aria-label="Remove attachment"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white/70 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <DmAttachmentSheet
            open={showAttachMenu}
            onClose={() => setShowAttachMenu(false)}
            onPickFile={(file) => {
              setDraftFile(file);
              setDraftCoolerupVideo(null);
              setDraftGif(null);
              setShowAttachMenu(false);
            }}
            onOpenGif={() => {
              setShowGifs(true);
            }}
            onPickCoolerupVideo={(video) => {
              setDraftCoolerupVideo(video);
              setDraftFile(null);
              setDraftGif(null);
              setShowAttachMenu(false);
            }}
            viewOnce={viewOnceDraft}
            onToggleViewOnce={() => setViewOnceDraft((v) => !v)}
            permission={mediaPermission}
            uploading={sending}
          />

          <div className="flex items-center gap-2 border-t border-white/15 p-3">
            <button
              type="button"
              onClick={() => {
                setShowGifs(false);
                setShowAttachMenu((v) => !v);
              }}
              aria-label="Add attachment"
              aria-expanded={showAttachMenu}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white hover:bg-zinc-800"
            >
              <Plus className="h-5 w-5" />
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              placeholder="Message..."
              maxLength={2000}
              className="min-w-0 flex-1 rounded-full border border-white/15 bg-zinc-900 px-4 py-2.5 text-sm text-white placeholder:text-white/40 outline-none focus:border-primary"
            />
            <Button
              onClick={() => void send()}
              disabled={sending}
              className="h-11 rounded-full px-5"
            >
              {sending ? "Sending..." : "Send"}
            </Button>
          </div>
        </>
      )}

      {lightboxState && (
        <DmMediaLightbox
          items={lightboxState.items}
          initialIndex={lightboxState.initialIndex}
          onClose={() => setLightboxState(null)}
          onOpenActions={(item) => {
            if (item.msg) {
              setLightboxState(null);
              setActionTarget(item.msg);
            }
          }}
        />
      )}

      {actionTarget && auth.user && me && (
        <DmMediaActionSheet
          msg={actionTarget}
          resolvedUrl={resolvedUrls[actionTarget.id]}
          myUserId={auth.user.id}
          myHandle={me}
          recentRecipients={recentRecipients}
          onClose={() => setActionTarget(null)}
          onDeleted={(id) => {
            setMsgs((prev) => prev.filter((row) => row.id !== id));
          }}
          onForwarded={(newRow) => {
            if (newRow) {
              setMsgs((prev) => [...prev, newRow]);
            }
          }}
        />
      )}
    </div>
  );
}
