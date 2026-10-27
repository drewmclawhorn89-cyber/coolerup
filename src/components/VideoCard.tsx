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
import { Link } from "@tanstack/react-router";
import {
  Ban,
  Bookmark,
  EyeOff,
  Flag,
  Heart,
  MessageCircle,
  MoreVertical,
  Repeat2,
  Share2,
} from "lucide-react";
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
import { useAuth } from "@/hooks/useAuth";
import { haptic, readBool } from "@/lib/prefs";
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
import { useBlocked } from "@/lib/safety";
import { resolveAvatarUrl } from "./EditProfileDialog";

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

  // --- moderation -----------------------------------------------------------
  const { block } = useBlocked();
  const [isBanned, setIsBanned] = useState(false);
  const [notInterested, setNotInterested] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState<ReportReason | null>(null);
  const [reportDetails, setReportDetails] = useState("");
  const [submittingReport, setSubmittingReport] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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

  // Close the ... menu on outside click / Escape.
  useEffect(() => {
    if (!showMenu) return;
    const onDown = (e: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowMenu(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [showMenu]);

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
      } else if (result.banned) {
        toast.success(`Thanks - @${video.username} was automatically restricted`);
        setIsBanned(true);
      } else {
        toast.success("Report sent. Thanks for keeping coolerup safe");
      }
    } finally {
      setSubmittingReport(false);
    }
  }, [auth, reportDetails, reportReason, submittingReport, video.id, video.username]);

  const hideBecauseNotInterested = useCallback(() => {
    setShowMenu(false);
    setNotInterested(true);
    try {
      const key = "loop-not-interested";
      const list = JSON.parse(localStorage.getItem(key) || "[]") as string[];
      if (!list.includes(video.id)) localStorage.setItem(key, JSON.stringify([...list, video.id]));
    } catch {
      /* ignore */
    }
    window.dispatchEvent(new Event("loop-not-interested-changed"));
    toast("We'll show you fewer videos like this");
  }, [video.id]);

  const blockAuthor = useCallback(async () => {
    setShowMenu(false);
    await block(video.username);
    setNotInterested(true);
  }, [block, video.username]);

  // Read prefs once per mount instead of on every render.
  const [dataSaver] = useState(() => readBool("data-saver"));
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

  const toggleFollow = useCallback(async () => {
    if (!auth.user || !myUsername) return auth.signIn();
    const next = !isFollowing;
    setIsFollowing(next);
    onFollowChange?.(video.username, next);
    const { error } = next
      ? await supabase
          .from("follows")
          .insert({
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
    }
  }, [auth.user, auth.signIn, isFollowing, myUsername, onFollowChange, video.username]);

  // Single shared observer decides whether this card is close enough to load.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    return observeIntersection(el, (e) => setNear(!!e && e.isIntersecting), {
      rootMargin: "50% 0px 50% 0px",
    });
  }, []);

  useEffect(() => {
    if (!near) {
      setSrc("");
      return;
    }
    let blobUrl = "";
    let alive = true;
    getSaved(video.id)
      .catch(() => null)
      .then(async (saved) => {
        if (!alive) return;
        if (saved) {
          blobUrl = URL.createObjectURL(saved.blob);
          setSrc(blobUrl);
        } else {
          const u = await resolveVideoUrl(video.video_url);
          if (alive) setSrc(u);
        }
      });
    return () => {
      alive = false;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [video.id, video.video_url, near]);

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
      // save notification to account
      const { data: owner } = await supabase
        .from("profiles")
        .select("id")
        .eq("handle", video.username)
        .maybeSingle();
      if (owner && owner.id !== authUser.id) {
        await supabase.from("notifications").insert({
          target_user_id: owner.id,
          actor_user_id: authUser.id,
          type: "like",
          video_id: video.id,
          text: "liked your fit",
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
        const { data: owner } = await supabase
          .from("profiles")
          .select("id")
          .eq("handle", video.username)
          .maybeSingle();
        if (owner && owner.id !== authUser.id) {
          await supabase.from("notifications").insert({
            target_user_id: owner.id,
            actor_user_id: authUser.id,
            video_id: video.id,
            type: "repost",
            text: `${myUsername ?? "Someone"} reposted your video`,
            read: false,
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
                muted={false}
                playsInline
                preload={dataSaver ? "none" : "metadata"}
                disableRemotePlayback
                onClick={togglePlay}
                onDoubleClick={() => !liked && toggleLike()}
                onTimeUpdate={(e) => {
                  const v = e.currentTarget;
                  if (v.duration && progressRef.current) {
                    progressRef.current.style.width = `${(v.currentTime / v.duration) * 100}%`;
                  }
                }}
                className={`h-full w-full cursor-pointer ${full ? "object-contain" : "object-cover"}`}
              />
            )}

            {burst && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
              >
                <Heart className="heart-pop h-28 w-28 fill-primary text-primary drop-shadow-[0_0_24px_rgba(255,45,85,0.8)]" />
              </div>
            )}

            {/* ... overflow menu: Report / Not interested / Block user */}
            <div ref={menuRef} className="absolute right-2 top-4 z-30 flex flex-col items-end">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu((v) => !v);
                }}
                aria-label="More options"
                aria-expanded={showMenu}
                className="flex h-9 w-9 items-center justify-center rounded-full text-white/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] transition hover:bg-black/30 hover:text-white"
              >
                <MoreVertical className="h-6 w-6" />
              </button>

              {showMenu && (
                <div
                  role="menu"
                  className="mt-1 w-52 overflow-hidden rounded-xl border border-border bg-popover/95 py-1 text-popover-foreground shadow-xl backdrop-blur"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      if (!auth.user) {
                        void auth.signIn();
                        return;
                      }
                      setShowReport(true);
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-accent"
                  >
                    <Flag className="h-4 w-4" />
                    Report
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      hideBecauseNotInterested();
                    }}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium hover:bg-accent"
                  >
                    <EyeOff className="h-4 w-4" />
                    Not interested
                  </button>
                  {video.username !== myUsername && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        void blockAuthor();
                      }}
                      className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm font-medium text-destructive hover:bg-accent"
                    >
                      <Ban className="h-4 w-4" />
                      Block @{video.username}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div
              className={`video-caption absolute inset-x-0 bottom-0 z-20 pb-20 pl-2 pr-20 pt-16 ${showCaptions ? "" : "md:hidden"}`}
            >
              <Link
                to="/u/$username"
                params={{ username: video.username }}
                className="break-words text-sm font-bold"
              >
                @{video.username}
              </Link>
              <p className="mt-1 line-clamp-3 break-words text-sm">{captionText}</p>
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
        <div className="absolute bottom-20 right-2 z-20 flex flex-col items-center gap-4 md:static md:mb-16 md:gap-5">
          <Link
            to="/u/$username"
            params={{ username: video.username }}
            aria-label={`View @${video.username}'s profile`}
            className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary font-display text-lg uppercase text-primary-foreground md:h-12 md:w-12"
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
              onClick={toggleFollow}
              className={`-mt-3 rounded-full px-3 py-1 text-xs font-bold transition ${isFollowing ? "bg-secondary text-foreground" : "bg-primary text-primary-foreground"}`}
            >
              {isFollowing ? "Following" : "Follow"}
            </button>
          )}

          <Action label={formatCount(likes)} onClick={toggleLike} active={liked}>
            <Heart
              className={`h-8 w-8 ${liked ? "fill-primary text-white" : ""} ${liked && burst ? "heart-pop-btn" : ""}`}
            />
          </Action>
          <Action label={formatCount(comments)} onClick={() => setShowComments(true)}>
            <MessageCircle className="h-8 w-8" />
          </Action>
          <button
            type="button"
            onClick={() => void toggleRepost()}
            aria-label={reposted ? "Undo repost" : "Repost"}
            aria-pressed={reposted}
            className="flex flex-col items-center gap-1"
          >
            <span className="flex h-11 w-11 items-center justify-center md:h-12 md:w-12">
              <Repeat2
                className={`h-8 w-8 transition ${reposted ? "fill-yellow-400 text-yellow-400" : "text-white"}`}
              />
            </span>
            <span
              className={`text-[12px] font-bold ${reposted ? "text-yellow-400" : "text-white"}`}
            >
              {formatCount(repostCount)}
            </span>
          </button>
          <Action label={formatCount(shares)} onClick={() => setShowShare(true)}>
            <Share2 className="h-8 w-8" />
          </Action>
          <button
            type="button"
            onClick={(e) => void toggleSave(e)}
            className="flex flex-col items-center"
          >
            <Bookmark
              className={`h-8 w-8 text-white ${isSaved ? "fill-yellow-400 text-yellow-400" : ""}`}
            />
            <span className="mt-1 text-[11px] text-white">Save</span>
          </button>
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

function Action({
  children,
  label,
  onClick,
  active,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      onClick={onClick}
      aria-label={typeof children === "object" && children ? undefined : label}
      className="h-auto flex-col gap-1 p-0 text-xs font-semibold hover:bg-transparent [&_svg]:size-6"
    >
      <span
        className={`flex h-11 w-11 items-center justify-center rounded-full bg-overlay backdrop-blur-sm transition hover:bg-accent md:h-12 md:w-12 md:bg-secondary ${active ? "scale-110" : ""}`}
      >
        {children}
      </span>
      {label}
    </Button>
  );
}
