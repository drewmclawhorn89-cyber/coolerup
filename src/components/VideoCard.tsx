import {
  memo,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { Bookmark, Heart, MessageCircle, Music, Play, Repeat2, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  formatCount,
  isImageUrl,
  parseCaption,
  resolveVideoUrl,
  songStreamUrl,
  type Video,
} from "@/lib/loop";
import { getSaved } from "@/lib/offline";
import { SoundBar } from "@/components/SoundBar";
import {
  cacheSound,
  createSoundFromVideo,
  getCachedSound,
  getSound,
  soundAudioUrl,
  type Sound,
} from "@/lib/sounds";
import { useAuth } from "@/hooks/useAuth";
import { haptic, readBool } from "@/lib/prefs";
import { isLiteMode, useNetwork } from "@/lib/network";
import { observeIntersection } from "@/lib/observer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { REPORT_REASONS, checkIfBanned, reportContent, type ReportReason } from "@/lib/moderation";
import { resolveAvatarUrl } from "./EditProfileDialog";
import { notifyUser, profileIdForHandle } from "@/lib/notify";

const Comments = lazy(() => import("./Comments").then((m) => ({ default: m.Comments })));
const ShareMenu = lazy(() => import("./ShareMenu").then((m) => ({ default: m.ShareMenu })));

/** Cache resolved avatar URLs per handle so feed scrolling doesn't refetch. */
const avatarCache = new Map<string, string | null>();
/** Dedupe concurrent avatar lookups for the same handle. */
const avatarInflight = new Map<string, Promise<string | null>>();

async function loadAvatar(username: string): Promise<string | null> {
  if (avatarCache.has(username)) return avatarCache.get(username) ?? null;
  const pending = avatarInflight.get(username);
  if (pending) return pending;
  const promise = (async () => {
    try {
      const { data } = await supabase
        .from("profiles")
        .select("avatar_url")
        .eq("handle", username)
        .maybeSingle();
      const url = await resolveAvatarUrl(
        (data as { avatar_url?: string | null } | null)?.avatar_url,
      );
      avatarCache.set(username, url);
      return url;
    } catch {
      return null;
    } finally {
      avatarInflight.delete(username);
    }
  })();
  avatarInflight.set(username, promise);
  return promise;
}

export type VideoCardProps = {
  video: Video;
  liked: boolean;
  muted: boolean;
  onToggleMute: () => void;
  onLikeChange: (videoId: string, liked: boolean) => void;
  /** Batched from the feed when available; falls back to a per-card query. */
  isFollowing?: boolean;
  onFollowChange?: (username: string, following: boolean) => void;
  isSaved?: boolean;
  onSavedChange?: (videoId: string, saved: boolean) => void;
};

function VideoCardImpl({
  video,
  liked,
  muted,
  onToggleMute,
  onLikeChange,
  isFollowing: isFollowingProp,
  onFollowChange,
  isSaved: isSavedProp,
  onSavedChange,
}: VideoCardProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState("");
  const [likes, setLikes] = useState(video.likes_count);
  const [comments, setComments] = useState(video.comments_count);
  const [shares, setShares] = useState(video.shares_count);
  const [reposted, setReposted] = useState(false);
  const [repostCount, setRepostCount] = useState(video.reposts ?? video.reposts_count ?? 0);
  const [showComments, setShowComments] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [isSaved, setIsSaved] = useState(isSavedProp ?? false);
  const [burst, setBurst] = useState(false);
  const [isFollowing, setIsFollowing] = useState(isFollowingProp ?? false);
  const auth = useAuth();
  const myUsername = auth.handle;
  const [authorAvatar, setAuthorAvatar] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement>(null);

  // The feed paints from a cached snapshot first, then swaps in fresh rows. The
  // card instance survives that swap (same React key), so `useState` keeps the
  // stale cached numbers — a video you liked could show a filled heart with a
  // "0" next to it. Re-sync whenever the incoming row's counters change.
  useEffect(() => {
    setLikes(video.likes_count ?? 0);
  }, [video.id, video.likes_count]);
  useEffect(() => {
    setComments(video.comments_count ?? 0);
  }, [video.id, video.comments_count]);
  useEffect(() => {
    setShares(video.shares_count ?? 0);
  }, [video.id, video.shares_count]);
  useEffect(() => {
    setRepostCount(video.reposts ?? video.reposts_count ?? 0);
  }, [video.id, video.reposts, video.reposts_count]);

  // --- sound ("Use this sound") --------------------------------------------
  const [sound, setSound] = useState<Sound | null>(
    () => (video.sound as Sound | undefined) ?? getCachedSound(video.sound_id),
  );
  const [soundSrc, setSoundSrc] = useState("");
  const soundAudioRef = useRef<HTMLAudioElement>(null);
  const [originalAudio, setOriginalAudio] = useState(false);
  const soundId = video.sound_id ?? sound?.id ?? null;
  const navigate = useNavigate();
  const [soundBusy, setSoundBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const soundTitle = sound?.title ?? `Original sound - @${video.username}`;

  // Older videos (and rows created before the sounds backfill) have no sound
  // row yet, so the button creates one on demand and then opens the page.
  const openSound = useCallback(async () => {
    if (soundId) {
      void navigate({ to: "/sound/$soundId", params: { soundId } });
      return;
    }
    setSoundBusy(true);
    try {
      const id = await createSoundFromVideo(video.id);
      if (id) void navigate({ to: "/sound/$soundId", params: { soundId: id } });
      else toast.error("Couldn't open this sound");
    } finally {
      setSoundBusy(false);
    }
  }, [soundId, video.id, navigate]);
  // A borrowed sound is overlaid on top of the video. The video's own original
  // sound is already in the file, so it doesn't need a second audio element.
  // Recordings made with a sound have it baked into the file ([[baked]]), so
  // they must not overlay it again.
  const soundBakedIn = parseCaption(video.caption).baked;
  const hasBorrowedSound = !!sound && sound.original_video_id !== video.id && !soundBakedIn;

  // --- moderation -----------------------------------------------------------
  const [isBanned, setIsBanned] = useState(false);
  const [notInterested, setNotInterested] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);

  // Hide the card outright if the author is banned. The database already filters
  // these out of the feed, so this only matters for stale caches.
  useEffect(() => {
    if (!video.username) return;
    let active = true;
    void checkIfBanned(video.username).then((banned) => {
      if (active && banned) setIsBanned(true);
    });
    return () => {
      active = false;
    };
  }, [video.username]);

  const submitReport = useCallback(async () => {
    if (!reportReason || submittingReport) return;
    if (!auth.user) {
      setShowReport(false);
      void auth.signIn();
      return;
    }
    setSubmittingReport(true);
    try {
      const result = await reportContent(video.id, video.username, reportReason, reportDetails);
      if (!result.ok) {
        toast.error(result.error || "Couldn't send report");
        return;
      }
      setShowReport(false);
      setReportReason(null);
      setReportDetails("");
      if (result.duplicate) {
        toast.success("You already reported this - thanks");
      } else {
        toast.success("Report sent. Thanks for keeping coolerup safe");
      }
    } finally {
      setSubmittingReport(false);
    }
  }, [auth, reportDetails, reportReason, submittingReport, video.id, video.username]);

  // Read prefs once per mount instead of on every render.
  const net = useNetwork();
  const lite = isLiteMode(net);
  const [showCaptions] = useState(() => readBool("captions"));
  const [autoplay] = useState(() => readBool("autoplay", true));

  useEffect(() => {
    const username = video.username;
    if (!username) return;
    if (myUsername && username === myUsername && auth.avatar) {
      setAuthorAvatar(auth.avatar);
      return;
    }
    let active = true;
    void loadAvatar(username).then((url) => {
      if (active) setAuthorAvatar(url);
    });
    return () => {
      active = false;
    };
  }, [video.username, myUsername, auth.avatar]);

  // Load the sound row (feed rows embed it; profile grids don't).
  useEffect(() => {
    if (!video.sound_id) {
      setSound(null);
      return;
    }
    if (video.sound) {
      const embedded = video.sound as Sound;
      cacheSound(embedded);
      setSound(embedded);
      return;
    }
    const cached = getCachedSound(video.sound_id);
    if (cached) setSound(cached);
    let active = true;
    void getSound(video.sound_id).then((row) => {
      if (active) setSound(row);
    });
    return () => {
      active = false;
    };
  }, [video.sound_id, video.sound]);

  // Resolve the audio source for a borrowed sound (handles storage: URLs).
  useEffect(() => {
    if (!sound?.audio_url) {
      setSoundSrc("");
      return;
    }
    let active = true;
    void soundAudioUrl(sound).then((url) => {
      if (active) setSoundSrc(url);
    });
    return () => {
      active = false;
    };
  }, [sound?.id, sound?.audio_url]);

  // Keep the overlay audio in step with the video.
  const syncSound = useCallback(
    (playing: boolean) => {
      const a = soundAudioRef.current;
      const v = ref.current;
      if (!a || !v || !hasBorrowedSound) return;
      if (!playing) {
        a.pause();
        return;
      }
      try {
        if (a.readyState > 0) {
          const duration = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
          const target = duration ? v.currentTime % duration : v.currentTime;
          if (Math.abs(a.currentTime - target) > 0.35) a.currentTime = target;
        }
        a.muted = muted;
        void a.play().catch(() => {});
      } catch {
        /* audio element not ready yet */
      }
    },
    [hasBorrowedSound, muted],
  );

  // Start/stop the overlay as the card enters and leaves the viewport.
  useEffect(() => {
    const el = cardRef.current;
    const a = soundAudioRef.current;
    if (!el || !a || !hasBorrowedSound) return;
    return observeIntersection(
      el,
      (e) => {
        if (e && e.isIntersecting && e.intersectionRatio > 0.6) {
          if (ref.current && !ref.current.paused) syncSound(true);
        } else {
          a.pause();
        }
      },
      { threshold: [0, 0.6, 1] },
    );
  }, [hasBorrowedSound, soundSrc, syncSound]);

  useEffect(() => {
    if (soundAudioRef.current) soundAudioRef.current.muted = muted;
  }, [muted]);

  // Keep batched props in sync when the parent learns the state later.
  useEffect(() => {
    if (isSavedProp !== undefined) setIsSaved(isSavedProp);
  }, [isSavedProp]);
  useEffect(() => {
    if (isFollowingProp !== undefined) setIsFollowing(isFollowingProp);
  }, [isFollowingProp]);

  // Fallback only when the parent doesn't provide batched state (e.g. profile page).
  useEffect(() => {
    if (isSavedProp !== undefined || !auth.user) return;
    let active = true;
    supabase
      .from("saved_videos")
      .select("video_id")
      .eq("user_id", auth.user.id)
      .eq("video_id", video.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setIsSaved(!!data);
      });
    return () => {
      active = false;
    };
  }, [auth.user?.id, video.id, isSavedProp]);

  // Has the signed-in user already reposted this video?
  useEffect(() => {
    if (!auth.user) {
      setReposted(false);
      return;
    }
    let active = true;
    supabase
      .from("reposts")
      .select("id")
      .eq("video_id", video.id)
      .eq("user_id", auth.user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setReposted(!!data);
      });
    return () => {
      active = false;
    };
  }, [auth.user?.id, video.id]);

  useEffect(() => {
    if (isFollowingProp !== undefined || !auth.user || !myUsername || video.username === myUsername)
      return;
    let active = true;
    supabase
      .from("follows")
      .select("id")
      .eq("follower_id", auth.user.id)
      .eq("following_username", video.username)
      .maybeSingle()
      .then(({ data }) => {
        if (active) setIsFollowing(!!data);
      });
    return () => {
      active = false;
    };
  }, [video.username, auth.user?.id, myUsername, isFollowingProp]);

  const toggleSave = useCallback(
    async (e?: MouseEvent) => {
      e?.stopPropagation();
      if (!auth.user) {
        toast.error("Sign in to save videos");
        return;
      }
      const next = !isSaved;
      setIsSaved(next);
      onSavedChange?.(video.id, next);
      const { error } = next
        ? await supabase.from("saved_videos").insert({ user_id: auth.user.id, video_id: video.id })
        : await supabase
            .from("saved_videos")
            .delete()
            .eq("user_id", auth.user.id)
            .eq("video_id", video.id);
      // 23505 = already saved, which is fine
      if (error && error.code !== "23505") {
        console.error(error);
        setIsSaved(!next);
        onSavedChange?.(video.id, !next);
        toast.error(`Couldn't save: ${error.message}`);
        return;
      }
      toast.success(next ? "Saved to your profile" : "Removed from saved");
    },
    [auth.user, isSaved, onSavedChange, video.id],
  );

  const isImage =
    isImageUrl(video.video_url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(video.video_url);
  const { text: captionText, song, full } = parseCaption(video.caption);
  const songRef = useRef<HTMLAudioElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  // In lite mode only the card actually filling the viewport may download.
  const [active, setActive] = useState(false);
  const [manualLoad, setManualLoad] = useState(false);
  const [retry, setRetry] = useState(0);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");

  const toggleFollow = useCallback(async () => {
    if (!auth.user || !myUsername) return auth.signIn();
    const next = !isFollowing;
    setIsFollowing(next);
    onFollowChange?.(video.username, next);
    const { error } = next
      ? await supabase.from("follows").insert({
          follower_id: auth.user.id,
          follower_username: myUsername,
          following_username: video.username,
        })
      : await supabase
          .from("follows")
          .delete()
          .eq("follower_id", auth.user.id)
          .eq("following_username", video.username);
    if (error) {
      setIsFollowing(!next);
      onFollowChange?.(video.username, !next);
      toast.error("Couldn't update follow");
    } else if (next) {
      const ownerId = await profileIdForHandle(video.username);
      if (ownerId) {
        await notifyUser({
          targetUserId: ownerId,
          actorUserId: auth.user.id,
          type: "follow",
          text: `${myUsername} started following you`,
          url: `/u/${myUsername}`,
        });
      }
    }
  }, [auth.user, auth.signIn, isFollowing, myUsername, onFollowChange, video.username]);

  // Single shared observer decides whether this card is close enough to load.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    return observeIntersection(
      el,
      (e) => {
        setNear(!!e && e.isIntersecting);
        setActive(!!e && e.isIntersecting && e.intersectionRatio > 0.6);
      },
      { rootMargin: "50% 0px 50% 0px", threshold: [0, 0.6, 1] },
    );
  }, []);

  // Lite mode streams one video at a time; otherwise preload the next card.
  const shouldLoad = lite ? active || manualLoad : near;

  // Drop a manually-started video once the card is well off screen so it stops
  // holding a network connection and memory.
  useEffect(() => {
    if (!near) setManualLoad(false);
  }, [near]);

  useEffect(() => {
    if (!shouldLoad) {
      setSrc("");
      setLoadState("idle");
      return;
    }
    let blobUrl = "";
    let alive = true;
    setLoadState("loading");
    getSaved(video.id)
      .catch(() => null)
      .then(async (saved) => {
        if (!alive) return;
        if (saved) {
          blobUrl = URL.createObjectURL(saved.blob);
          setSrc(blobUrl);
        } else {
          const u = await resolveVideoUrl(video.video_url);
          if (!alive) return;
          setSrc(u);
          if (!u) setLoadState("error");
        }
      })
      .catch(() => {
        if (alive) setLoadState("error");
      });
    return () => {
      alive = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [video.id, video.video_url, shouldLoad, retry]);

  // If the user tapped "play" on a card that wasn't auto-loading, start it once
  // the source is ready.
  useEffect(() => {
    if (!manualLoad || !src) return;
    const el = ref.current;
    if (el) el.play().catch(() => {});
  }, [manualLoad, src]);

  useEffect(() => {
    const el = ref.current;
    if (!el || isImage) return;
    return observeIntersection(
      el,
      (e) => {
        if (e && e.isIntersecting && e.intersectionRatio > 0.6) {
          if (autoplay) el.play().catch(() => {});
        } else el.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
  }, [src, isImage, autoplay]);

  useEffect(() => {
    const el = cardRef.current;
    const a = songRef.current;
    if (!el || !a || !song) return;
    const stop = observeIntersection(
      el,
      (e) => {
        if (e && e.isIntersecting && e.intersectionRatio > 0.6) {
          a.currentTime = 0;
          a.play().catch(() => {});
        } else a.pause();
      },
      { threshold: [0, 0.6, 1] },
    );
    return () => {
      stop();
      a.pause();
    };
  }, [song?.id]);

  const togglePlay = () => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) el.play();
    else el.pause();
  };

  const toggleLike = useCallback(async () => {
    const next = !liked;
    haptic();
    onLikeChange(video.id, next);
    setLikes((n) => n + (next ? 1 : -1));
    if (next) {
      setBurst(true);
      setTimeout(() => setBurst(false), 650);
    }
    const authUser = auth.user;
    if (!authUser) {
      toast.error("Please log in to like");
      onLikeChange(video.id, !next);
      setLikes((n) => n + (next ? -1 : 1));
      return;
    }
    const { error } = next
      ? await supabase.from("likes").insert({ video_id: video.id, user_id: authUser.id })
      : await supabase.from("likes").delete().eq("video_id", video.id).eq("user_id", authUser.id);
    if (error) {
      onLikeChange(video.id, !next);
      setLikes((n) => n + (next ? -1 : 1));
      toast.error("Couldn't save your like");
    } else if (next) {
      // Save the in-app notification and push it to the owner's devices.
      const ownerId = await profileIdForHandle(video.username);
      if (ownerId) {
        await notifyUser({
          targetUserId: ownerId,
          actorUserId: authUser.id,
          type: "like",
          videoId: video.id,
          text: `${myUsername ?? "Someone"} liked your video`,
          url: "/",
        });
      }
    }
  }, [auth.user, liked, onLikeChange, video.id, video.username]);

  const toggleRepost = useCallback(async () => {
    const authUser = auth.user;
    if (!authUser) {
      toast.error("Sign in to repost");
      auth.signIn();
      return;
    }
    const next = !reposted;
    haptic();
    setReposted(next);
    setRepostCount((c) => Math.max(0, next ? c + 1 : c - 1));
    if (next) toast.success("Reposted! Your followers will see this");

    try {
      if (next) {
        const { error } = await supabase
          .from("reposts")
          .insert({ video_id: video.id, user_id: authUser.id });
        // 23505 = already reposted, which is fine.
        if (error && error.code !== "23505") throw error;
        const ownerId = await profileIdForHandle(video.username);
        if (ownerId) {
          await notifyUser({
            targetUserId: ownerId,
            actorUserId: authUser.id,
            type: "repost",
            videoId: video.id,
            text: `${myUsername ?? "Someone"} reposted your video`,
            url: "/",
          });
        }
      } else {
        const { error } = await supabase
          .from("reposts")
          .delete()
          .eq("video_id", video.id)
          .eq("user_id", authUser.id);
        if (error) throw error;
      }
    } catch {
      // Roll back the optimistic UI if the write failed.
      setReposted(!next);
      setRepostCount((c) => Math.max(0, next ? c - 1 : c + 1));
      toast.error("Couldn't update repost");
    }
  }, [auth.user, auth.signIn, myUsername, reposted, video.id, video.username]);

  const onShared = useCallback(async () => {
    setShares((n) => n + 1);
    if (navigator.onLine) await supabase.rpc("increment_share", { _video_id: video.id });
  }, [video.id]);

  const seek = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el || !el.duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    el.currentTime = ((e.clientX - rect.left) / rect.width) * el.duration;
  };

  if (deleted || isBanned || notInterested) return null;

  return (
    <section className="feed-card relative h-full w-full snap-start snap-always bg-black md:flex md:items-center md:justify-center md:bg-transparent md:py-4">
      <div className="relative flex h-full w-full items-end md:h-auto md:w-auto md:gap-4">
        <div className="flex h-full min-w-0 flex-1 flex-col md:h-auto md:flex-none md:gap-3">
          <div
            ref={cardRef}
            className="relative h-full w-full overflow-hidden bg-black md:aspect-[9/16] md:h-[calc(100dvh-11rem)] md:max-h-[760px] md:w-auto md:rounded-2xl md:bg-card"
          >
            {src && isImage && (
              <img
                src={src}
                loading="lazy"
                decoding="async"
                alt={captionText || `Photo by @${video.username}`}
                onLoad={() => setLoadState("ready")}
                onError={() => setLoadState("error")}
                onDoubleClick={() => !liked && toggleLike()}
                className="h-full w-full cursor-pointer object-cover"
              />
            )}
            {song && isImage && (
              <audio ref={songRef} src={songStreamUrl(song.id)} loop muted={muted} preload="none" />
            )}
            {song && isImage && (
              <div className="absolute left-3 top-3 flex max-w-[70%] items-center gap-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-semibold text-white backdrop-blur">
                <span aria-hidden>♫</span>
                <span className="truncate">
                  {song.title} · {song.artist}
                </span>
              </div>
            )}
            {src && !isImage && (
              <video
                ref={ref}
                src={src}
                loop={!full}
                controls={full}
                muted={muted || (hasBorrowedSound && !originalAudio)}
                playsInline
                preload={lite ? "none" : "metadata"}
                disableRemotePlayback
                onClick={togglePlay}
                onDoubleClick={() => !liked && toggleLike()}
                onLoadedData={() => setLoadState("ready")}
                onError={() => setLoadState("error")}
                onPlay={() => {
                  setPlaying(true);
                  syncSound(true);
                }}
                onPause={() => {
                  setPlaying(false);
                  syncSound(false);
                }}
                onSeeking={() => syncSound(true)}
                onSeeked={() => syncSound(true)}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration && progressRef.current) {
                    progressRef.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
                  }
                  const a = soundAudioRef.current;
                  if (a && !a.paused && a.readyState > 0) {
                    const duration = Number.isFinite(a.duration) && a.duration > 0 ? a.duration : 0;
                    const target = duration ? v.currentTime % duration : v.currentTime;
                    if (Math.abs(a.currentTime - target) > 0.45) a.currentTime = target;
                  }
                }}
                className={`h-full w-full cursor-pointer ${full ? "object-contain" : "object-cover"}`}
              />
            )}

            {hasBorrowedSound && soundSrc && (
              <audio
                ref={soundAudioRef}
                src={soundSrc}
                loop
                muted={muted}
                preload="none"
                aria-hidden
              />
            )}

            {!isImage && loadState !== "ready" && (
              <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-gradient-to-b from-zinc-900 via-black to-black px-6 text-center">
                {loadState === "error" ? (
                  <>
                    <p className="text-sm text-white/70">Couldn't load this video.</p>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setLoadState("loading");
                        setRetry((r) => r + 1);
                      }}
                      className="rounded-full border border-white/30 px-4 py-1.5 text-xs font-bold text-white transition hover:bg-white/10"
                    >
                      Try again
                    </button>
                  </>
                ) : loadState === "idle" ? (
                  <>
                    <button
                      type="button"
                      aria-label="Play video"
                      onClick={(e) => {
                        e.stopPropagation();
                        setManualLoad(true);
                      }}
                      className="flex h-14 w-14 items-center justify-center rounded-full bg-white/15 text-white backdrop-blur transition hover:bg-white/25"
                    >
                      <Play className="h-7 w-7 fill-current" />
                    </button>
                    <p className="text-xs text-white/60">
                      {lite ? "Tap to play · lite mode" : "Tap to play"}
                    </p>
                  </>
                ) : (
                  <>
                    <span className="h-9 w-9 animate-spin rounded-full border-2 border-white/20 border-t-primary" />
                    <p className="text-xs text-white/60">
                      {lite ? "Loading in lite mode…" : "Loading…"}
                    </p>
                  </>
                )}
              </div>
            )}

            {burst && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
              >
                <Heart className="heart-pop h-28 w-28 fill-primary text-primary drop-shadow-[0_0_24px_rgba(255,45,85,0.8)]" />
              </div>
            )}

            <div className="video-caption absolute inset-x-0 bottom-0 z-20 pb-14 pl-2 pr-16 pt-16">
              {soundId && (
                <SoundBar
                  soundId={soundId}
                  title={sound?.title ?? `Original sound - @${video.username}`}
                  creatorUsername={sound?.creator_username ?? video.username}
                  originalAudio={originalAudio}
                  onToggleOriginalAudio={() => setOriginalAudio((on) => !on)}
                  showOriginalToggle={hasBorrowedSound}
                  className="mb-2"
                />
              )}
              <div className={showCaptions ? "" : "md:hidden"}>
                <Link
                  to="/u/$username"
                  params={{ username: video.username }}
                  className="break-words text-sm font-bold"
                >
                  @{video.username}
                </Link>
                <p className="mt-1 line-clamp-3 break-words text-sm">{captionText}</p>
              </div>
            </div>
            {!isImage && (
              <div onClick={seek} className="absolute inset-x-0 bottom-0 h-3 cursor-pointer">
                <div className="absolute inset-x-0 bottom-0 h-1 bg-foreground/20">
                  <div ref={progressRef} className="h-full bg-primary" style={{ width: "0%" }} />
                </div>
              </div>
            )}
          </div>
          <div className="hidden max-w-[calc((100dvh-11rem)*9/16)] md:block">
            <Link
              to="/u/$username"
              params={{ username: video.username }}
              className="font-bold hover:text-primary"
            >
              @{video.username}
            </Link>
            <p className="text-sm text-muted-foreground">{captionText}</p>
          </div>
        </div>
        <div className="absolute bottom-14 right-1.5 z-20 flex flex-col items-center gap-3.5 md:static md:mb-10 md:gap-3.5">
          {/* Avatar + follow badge — TikTok pins the + onto the avatar's chin. */}
          <div className="flex flex-col items-center">
            <Link
              to="/u/$username"
              params={{ username: video.username }}
              aria-label={`View @${video.username}'s profile`}
              className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-primary font-display text-base uppercase text-primary-foreground"
            >
              {authorAvatar ? (
                <img
                  src={authorAvatar}
                  alt={`@${video.username}`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
              ) : (
                video.username[0]
              )}
            </Link>
            {video.username !== myUsername && (
              <button
                type="button"
                onClick={toggleFollow}
                aria-label={isFollowing ? "Unfollow" : "Follow"}
                aria-pressed={isFollowing}
                className={`-mt-2.5 flex h-5 w-5 items-center justify-center rounded-full text-[12px] font-bold leading-none transition ${
                  isFollowing ? "bg-white text-black" : "bg-[#fe2c55] text-white"
                }`}
              >
                {isFollowing ? "✓" : "+"}
              </button>
            )}
          </div>

          {/* LIKE */}
          <RailButton
            label={formatCount(Math.max(likes ?? 0, liked ? 1 : 0))}
            onClick={toggleLike}
            pressed={liked}
            activeClass="text-[#fe2c55]"
          >
            <Heart
              className={`h-7 w-7 drop-shadow-lg ${
                liked ? "fill-[#fe2c55] text-[#fe2c55]" : "text-white"
              } ${liked && burst ? "heart-pop-btn" : ""}`}
            />
          </RailButton>

          {/* COMMENT */}
          <RailButton label={formatCount(comments)} onClick={() => setShowComments(true)}>
            <MessageCircle className="h-7 w-7 fill-white text-white drop-shadow-lg" />
          </RailButton>

          {/* REPOST */}
          <RailButton
            label={formatCount(Math.max(repostCount ?? 0, reposted ? 1 : 0))}
            onClick={() => void toggleRepost()}
            pressed={reposted}
            activeClass="text-yellow-400"
          >
            <Repeat2
              className={`h-7 w-7 drop-shadow-lg ${reposted ? "text-yellow-400" : "text-white"}`}
            />
          </RailButton>

          {/* BOOKMARK */}
          <RailButton
            label={isSaved ? "Saved" : ""}
            onClick={(e) => void toggleSave(e)}
            pressed={isSaved}
            activeClass="text-white"
          >
            <Bookmark
              className={`h-7 w-7 drop-shadow-lg ${isSaved ? "fill-white text-white" : "text-white"}`}
            />
          </RailButton>

          {/* SOUND — spinning record, sits with the other actions like TikTok */}
          {soundId ? (
            <Link
              to="/sound/$soundId"
              params={{ soundId }}
              aria-label={`Open sound: ${soundTitle}`}
              title={soundTitle}
              className="flex flex-col items-center"
            >
              <SoundDisc spinning={playing} />
              <SoundRailLabel title={soundTitle} />
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => void openSound()}
              disabled={soundBusy}
              aria-label={`Open sound: ${soundTitle}`}
              title={soundTitle}
              className="flex flex-col items-center bg-transparent p-0 focus-visible:outline-none"
            >
              <SoundDisc spinning={playing} busy={soundBusy} />
              <SoundRailLabel title={soundTitle} />
            </button>
          )}

          {/* SHARE */}
          <RailButton label="Share" onClick={() => setShowShare(true)}>
            <Share2 className="h-7 w-7 text-white drop-shadow-lg" />
          </RailButton>
        </div>
      </div>
      {showComments && (
        <Suspense fallback={null}>
          <Comments
            videoId={video.id}
            onClose={() => setShowComments(false)}
            onAdded={() => setComments((n) => n + 1)}
          />
        </Suspense>
      )}
      {showShare && (
        <Suspense fallback={null}>
          <ShareMenu
            video={video}
            onClose={() => setShowShare(false)}
            onShared={onShared}
            onDeleted={() => setDeleted(true)}
          />
        </Suspense>
      )}

      <Dialog
        open={showReport}
        onOpenChange={(open) => {
          setShowReport(open);
          if (!open) {
            setReportReason(null);
            setReportDetails("");
          }
        }}
      >
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Report this video</DialogTitle>
            <DialogDescription>
              Tell us what's wrong with @{video.username}'s video. Reports are anonymous - they
              never see who reported them.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            {REPORT_REASONS.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setReportReason(r.id)}
                className={`flex w-full items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                  reportReason === r.id
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-foreground/30 hover:bg-accent"
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{r.label}</span>
                  <span className="block text-xs text-muted-foreground">{r.hint}</span>
                </span>
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                    reportReason === r.id
                      ? "border-primary bg-primary"
                      : "border-muted-foreground/50"
                  }`}
                >
                  {reportReason === r.id && (
                    <span className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                  )}
                </span>
              </button>
            ))}
          </div>

          <textarea
            value={reportDetails}
            onChange={(e) => setReportDetails(e.target.value.slice(0, 1000))}
            rows={3}
            placeholder="Add details (optional)"
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />

          <div className="flex items-center justify-between gap-2">
            <p className="text-[11px] leading-tight text-muted-foreground">
              Enough reports in a short window and the account is restricted automatically.
            </p>
            <div className="flex shrink-0 gap-2">
              <Button variant="ghost" onClick={() => setShowReport(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => void submitReport()}
                disabled={!reportReason || submittingReport}
              >
                {submittingReport ? "Sending..." : "Submit"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/**
 * Memoized: the feed re-renders on likes/mute changes and we don't want every
 * offscreen card to re-render with it.
 */
export const VideoCard = memo(VideoCardImpl);

/** TikTok-style spinning record used for the sound action. */
function SoundDisc({ spinning, busy }: { spinning?: boolean; busy?: boolean }) {
  return (
    <span
      className={`relative flex h-9 w-9 items-center justify-center rounded-full border border-white/25 bg-gradient-to-br from-zinc-600 via-zinc-900 to-black shadow-[0_4px_16px_rgba(0,0,0,0.55)] ${
        busy ? "animate-pulse opacity-70" : ""
      }`}
    >
      <span className="absolute inset-1 rounded-full border border-white/15" />
      <span className="absolute inset-[42%] rounded-full bg-white/80" />
      <Music
        className={`relative h-5 w-5 text-white drop-shadow ${spinning ? "animate-spin-slow" : ""}`}
      />
    </span>
  );
}

/**
 * TikTok shows the song name under the spinning record. The label scrolls so
 * long titles stay readable without widening the rail.
 */
function SoundRailLabel({ title }: { title: string }) {
  return (
    <span
      className="mt-0.5 block h-[13px] w-[72px] overflow-hidden text-[10px] font-bold leading-[13px] text-white drop-shadow"
      aria-hidden
    >
      <span className="animate-marquee flex w-max">
        <span className="whitespace-nowrap pr-4">{title}</span>
        <span className="whitespace-nowrap pr-4">{title}</span>
      </span>
    </span>
  );
}

function RailButton({
  children,
  label,
  onClick,
  pressed,
  activeClass = "text-white",
}: {
  children: React.ReactNode;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  pressed?: boolean;
  activeClass?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pressed}
      className="flex flex-col items-center bg-transparent p-0 focus-visible:outline-none"
    >
      <span className="flex items-center justify-center">{children}</span>
      {/* Fixed height so an empty label (unsaved bookmark) keeps the same
          rhythm as the others — TikTok spaces all six icons evenly. */}
      <span
        className={`mt-0.5 block h-[13px] text-[11px] font-bold leading-[13px] drop-shadow ${
          pressed ? activeClass : "text-white"
        }`}
      >
        {label}
      </span>
    </button>
  );
}
