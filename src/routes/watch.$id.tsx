import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Check,
  CornerDownRight,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  Pencil,
  Play,
  Repeat2,
  Share2,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { offlinePlan } from "@/lib/subscriptions";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { EditFullVideoDialog } from "@/components/EditFullVideoDialog";
import { FullVideoShareMenu } from "@/components/FullVideoShareMenu";
import { FullVideoCard } from "@/components/FullVideoCard";
import { GifPicker } from "@/components/GifPicker";
import { useYouTubeDurations, withYouTubeDurations } from "@/lib/useYouTubeDurations";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getPendingVideo } from "@/lib/pendingUploads";
import { useFullVideoSave } from "@/lib/savedFullVideos";
import { useFullVideoOffline } from "@/lib/useFullVideoOffline";
import { formatBytes } from "@/lib/offline";
import {
  addComment,
  deleteFullVideo,
  finalizeFullVideo,
  formatViews,
  getFullVideo,
  getMyReaction,
  getReactionCounts,
  incrementFullVideoViews,
  listComments,
  listRelatedVideos,
  resolveFullVideoUrl,
  setReaction,
  storageObjectSize,
  STORAGE_PREFIX,
  timeAgo,
  toggleCommentLike,
  type FullVideo,
  type FullVideoComment,
  type Reaction,
} from "@/lib/fullVideos";

export const Route = createFileRoute("/watch/$id")({
  head: () => ({
    meta: [
      { title: "Watch — Coolerup" },
      { name: "description", content: "Watch full-length videos on Coolerup." },
      { property: "og:title", content: "Watch — Coolerup" },
      { property: "og:description", content: "Watch full-length videos and YouTube picks on Coolerup." },
      { property: "og:type", content: "video.other" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: WatchPage,
});

function WatchPage() {
  const { id } = useParams({ from: "/watch/$id" });
  const auth = useAuth();
  const navigate = useNavigate();

  const [video, setVideo] = useState<FullVideo | null>(null);
  const [related, setRelated] = useState<FullVideo[]>([]);
  const [src, setSrc] = useState("");
  const [poster, setPoster] = useState("");
  const [renditions, setRenditions] = useState<{
    "1080p"?: string | null;
    "720p"?: string | null;
    "480p"?: string | null;
  }>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [likes, setLikes] = useState(0);
  const [dislikes, setDislikes] = useState(0);
  const [myReaction, setMyReaction] = useState<Reaction | null>(null);

  const [subscribed, setSubscribed] = useState(false);
  // Saved state lives in a shared store, so a video saved here shows the same
  // yellow button on the /videos grid and in the "Up next" rail.
  const { saved, toggle: toggleSave } = useFullVideoSave(video?.id ?? id);
  // Offline download state is shared with the /videos grid badge and share sheet.
  const offline = useFullVideoOffline(video ?? ({ id } as FullVideo));
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  const [comments, setComments] = useState<FullVideoComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [commentGif, setCommentGif] = useState<string | null>(null);
  const [commentGifCredit, setCommentGifCredit] = useState<string | null>(null);
  const [showGifs, setShowGifs] = useState(false);
  const [posting, setPosting] = useState(false);
  /** The comment being answered; null means a fresh top-level comment. */
  const [replyTo, setReplyTo] = useState<FullVideoComment | null>(null);

  const viewCounted = useRef(false);

  // The rail reuses the grid card, so YouTube picks there need the same
  // backfilled duration badge the /videos grid gets.
  const applyRelatedDurations = useCallback((durations: Record<string, number>) => {
    setRelated((list) => withYouTubeDurations(list, durations));
  }, []);
  useYouTubeDurations(related, applyRelatedDurations);

  /* ---------------- load video ---------------- */

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    viewCounted.current = false;

    void (async () => {
      try {
        const row = await getFullVideo(id);
        if (!alive) return;
        if (!row) {
          setError("That video could not be found.");
          setLoading(false);
          return;
        }
        setVideo(row);

        // Still uploading? If this tab did the upload we have the file on
        // disk, so play that instead of waiting for the object to exist.
        const local = row.status === "processing" ? getPendingVideo(row.id) : undefined;

        const [main, thumb, hd, sd, low] = await Promise.all([
          resolveFullVideoUrl(row.video_url),
          resolveFullVideoUrl(row.thumbnail_url),
          resolveFullVideoUrl(row.video_1080_url),
          resolveFullVideoUrl(row.video_720_url),
          resolveFullVideoUrl(row.video_480_url),
        ]);
        if (!alive) return;
        setSrc(local ? local.objectUrl : main);
        setPoster(local?.thumbUrl ?? thumb);
        setRenditions({ "1080p": hd || null, "720p": sd || null, "480p": low || null });

        const [counts, relatedRows] = await Promise.all([
          getReactionCounts(row.id),
          listRelatedVideos(row),
        ]);
        if (!alive) return;
        setLikes(counts.likes);
        setDislikes(counts.dislikes);
        setRelated(relatedRows);

        if (auth.user) {
          const mine = await getMyReaction(row.id, auth.user.id);
          if (alive) setMyReaction(mine);
        }

        const rows = await listComments(row.id, auth.user?.id ?? null);
        if (alive) setComments(rows);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Could not load this video.");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id, auth.user]);

  /* ---------------- poll while the upload finishes ---------------- */

  useEffect(() => {
    if (video?.status !== "processing") return;
    let alive = true;

    /** Swap the player over to the real object once it is playable. */
    const adopt = async (row: FullVideo) => {
      const [main, thumb] = await Promise.all([
        resolveFullVideoUrl(row.video_url),
        resolveFullVideoUrl(row.thumbnail_url),
      ]);
      if (!alive) return;
      setVideo(row);
      setSrc(main);
      setPoster(thumb);
    };

    const tick = async () => {
      try {
        const row = await getFullVideo(video.id);
        if (!alive || !row) return;

        if (row.status === "ready") {
          await adopt(row);
          return;
        }
        if (row.status === "failed") {
          setVideo(row);
          return;
        }

        // Still `processing`, and this browser isn't the one uploading. The
        // bytes may have landed while the row never got flipped to `ready`
        // (tab closed at 99%, the finalize call failed, etc). Compare what is
        // actually in storage against the expected size and finish the job.
        if (getPendingVideo(row.id)) return;
        if (row.video_url.startsWith(STORAGE_PREFIX)) {
          const path = row.video_url.slice(STORAGE_PREFIX.length);
          const size = await storageObjectSize(path);
          const expected = row.expected_bytes ?? 0;
          if (size && size > 0 && (expected === 0 || size >= expected)) {
            await finalizeFullVideo(row.id, {
              videoUrl: row.video_url,
              thumbnailUrl: row.thumbnail_url,
            });
            const healed = await getFullVideo(row.id);
            if (healed) await adopt(healed);
          }
        }
      } catch {
        // Keep polling; a transient failure is not worth surfacing here.
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), 3000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [video?.status, video?.id]);

  /* ---------------- subscription state ---------------- */

  useEffect(() => {
    if (!auth.user || !video) return;
    let alive = true;
    void (async () => {
      const db = supabase as any;
      const { data } = await db
        .from("follows")
        .select("id")
        .eq("follower_id", auth.user!.id)
        .eq("following_username", video.username)
        .maybeSingle();
      if (alive) setSubscribed(Boolean(data));
    })();
    return () => {
      alive = false;
    };
  }, [auth.user, video]);

  /* ---------------- actions ---------------- */

  /** Only the uploader can rename, re-tag or delete their own video. */
  const isOwner = !!auth.user && !!video && video.user_id === auth.user.id;

  /**
   * True when the row exists but the bytes are still in flight AND this browser
   * isn't the one holding the file — i.e. a stranger who has nothing to play.
   * The uploader keeps their local-copy player, so they never see this.
   */
  const waitingForUpload = video?.status === "processing" && !getPendingVideo(video.id);

  /**
   * The upload died. Only the owner can do anything about it. Also true when
   * the row is stuck on `processing` but carries an error — that happens on a
   * database that hasn't had `upload_recovery_sql.sql` run, where the `failed`
   * status is rejected and only the reason is stored.
   */
  const uploadFailed =
    video?.status === "failed" || (video?.status === "processing" && !!video?.upload_error);

  /** Finished uploading, but there is still no playable source. */
  const unplayable = !waitingForUpload && !uploadFailed && !!video && !src;

  async function removeFailed() {
    if (!video || !auth.user) return;
    try {
      await deleteFullVideo(video.id, auth.user.id);
      toast.success("Removed.");
      void navigate({ to: "/videos" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not remove this video.");
    }
  }

  const countView = useCallback(() => {
    if (!video || viewCounted.current) return;
    viewCounted.current = true;
    void incrementFullVideoViews(video.id);
    setVideo((v) => (v ? { ...v, views: Number(v.views) + 1 } : v));
  }, [video]);

  const react = async (next: Reaction) => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    if (!video) return;
    const target = myReaction === next ? null : next;

    // Optimistic update, then reconcile.
    const prev = { likes, dislikes, mine: myReaction };
    setMyReaction(target);
    setLikes((n) => n + (target === "like" ? 1 : 0) - (prev.mine === "like" ? 1 : 0));
    setDislikes((n) => n + (target === "dislike" ? 1 : 0) - (prev.mine === "dislike" ? 1 : 0));

    try {
      await setReaction(video.id, auth.user.id, target);
    } catch {
      setLikes(prev.likes);
      setDislikes(prev.dislikes);
      setMyReaction(prev.mine);
      toast.error("Could not save your reaction.");
    }
  };

  const toggleSubscribe = async () => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    if (!video) return;
    const db = supabase as any;
    const handle = auth.handle ?? auth.name ?? "you";

    if (subscribed) {
      setSubscribed(false);
      const { error } = await db
        .from("follows")
        .delete()
        .eq("follower_id", auth.user.id)
        .eq("following_username", video.username);
      if (error) {
        setSubscribed(true);
        toast.error("Could not unsubscribe.");
      }
    } else {
      setSubscribed(true);
      const { error } = await db.from("follows").insert({
        follower_id: auth.user.id,
        follower_username: handle,
        following_username: video.username,
      });
      if (error) {
        setSubscribed(false);
        toast.error("Could not subscribe.");
      }
    }
  };

  const repost = () => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    toast.success("Reposted");
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    const body = commentText.trim();
    if ((!body && !commentGif) || !video) return;

    setPosting(true);
    try {
      // Replies to a reply attach to the same top-level comment, so a thread
      // never nests deeper than one level.
      const parentId = replyTo ? (replyTo.parent_id ?? replyTo.id) : null;
      const row = await addComment(
        video.id,
        auth.user.id,
        auth.handle ?? auth.name ?? "you",
        body,
        parentId,
        commentGif,
        commentGifCredit,
      );
      setComments((c) => [row, ...c]);
      setCommentText("");
      setCommentGif(null);
      setCommentGifCredit(null);
      setShowGifs(false);
      setReplyTo(null);
    } catch {
      toast.error("Could not post your comment.");
    } finally {
      setPosting(false);
    }
  };

  /** Optimistically flip a comment's like, then settle on the server value. */
  const likeComment = async (comment: FullVideoComment) => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    const nextLiked = !comment.liked_by_me;
    setComments((list) =>
      list.map((c) =>
        c.id === comment.id
          ? { ...c, liked_by_me: nextLiked, like_count: c.like_count + (nextLiked ? 1 : -1) }
          : c,
      ),
    );
    try {
      const result = await toggleCommentLike(comment.id, auth.user.id, comment.liked_by_me);
      setComments((list) =>
        list.map((c) =>
          c.id === comment.id
            ? { ...c, liked_by_me: result.liked, like_count: result.like_count }
            : c,
        ),
      );
    } catch {
      // Put it back the way it was.
      setComments((list) =>
        list.map((c) =>
          c.id === comment.id
            ? { ...c, liked_by_me: comment.liked_by_me, like_count: comment.like_count }
            : c,
        ),
      );
      toast.error("Could not save your like.");
    }
  };

  /* ---------------- render ---------------- */

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !video) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-base font-semibold">{error ?? "Video not found"}</p>
        <Link to="/videos" className="mt-4 inline-block text-sm underline">
          Browse videos
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-0 pb-24 sm:px-3">
      <div className="flex items-center gap-2 px-3 py-2">
        <Link to="/videos" aria-label="Back to videos" className="rounded-full p-1 hover:bg-accent">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <span className="text-sm font-semibold">Watch</span>
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-6">
        <div className="min-w-0">
          {waitingForUpload ? (
            // The object isn't in storage yet, so there is nothing to play.
            // Show an honest placeholder instead of a dead player; the poll
            // above swaps this out the moment the upload finishes.
            <div className="mx-3 mt-2 flex aspect-video flex-col items-center justify-center gap-3 rounded-xl bg-muted text-center sm:mx-0">
              <Loader2 className="size-7 animate-spin text-muted-foreground" />
              <div className="px-6">
                <p className="text-sm font-semibold">This video is still uploading</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  It'll start playing here on its own — no need to refresh.
                </p>
              </div>
            </div>
          ) : uploadFailed ? (
            <div className="mx-3 mt-2 flex aspect-video flex-col items-center justify-center gap-3 rounded-xl bg-muted text-center sm:mx-0">
              <div className="px-6">
                <p className="text-sm font-semibold">This upload didn't finish</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {isOwner
                    ? (video.upload_error ?? "The file never finished uploading.")
                    : "The owner can re-upload it."}
                </p>
                {isOwner && (
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => void navigate({ to: "/upload-full" })}
                      className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                    >
                      Upload again
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeFailed()}
                      className="rounded-full bg-secondary px-4 py-2 text-sm font-semibold text-secondary-foreground"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : unplayable ? (
            <div className="mx-3 mt-2 flex aspect-video flex-col items-center justify-center gap-3 rounded-xl bg-muted text-center sm:mx-0">
              <div className="px-6">
                <p className="text-sm font-semibold">This video can't be played</p>
                <p className="mt-1 text-[13px] text-muted-foreground">
                  {isOwner
                    ? "The file isn't in storage. Upload it again to fix this."
                    : "The file is missing from storage."}
                </p>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => void navigate({ to: "/upload-full" })}
                    className="mt-4 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                  >
                    Upload again
                  </button>
                )}
              </div>
            </div>
          ) : video.is_youtube && video.youtube_id ? (
            <div className="mx-3 mt-2 sm:mx-0">
              {/* Red provenance badge above the player, the way a YouTube embed
                  announces itself. The grid stays clean; this is the one place
                  we tell the viewer the bytes come from YouTube. */}
              <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-youtube px-3 py-2 text-youtube-foreground">
                <span className="flex items-center gap-1.5 text-[13px] font-bold">
                  <Play className="size-4 fill-current" /> YouTube
                </span>
                <span className="text-[12px] opacity-90">Playing from YouTube</span>
              </div>

              <div className="aspect-video w-full overflow-hidden bg-background sm:rounded-lg">
                {/* The official IFrame player, with YouTube's own branding and
                    logo kept in the control bar (modestbranding=0). */}
                <iframe
                  className="h-full w-full"
                  title={video.title}
                  src={`https://www.youtube.com/embed/${encodeURIComponent(video.youtube_id)}?rel=0&modestbranding=0&playsinline=1`}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerPolicy="strict-origin-when-cross-origin"
                  allowFullScreen
                />
              </div>

              <a
                href={`https://www.youtube.com/watch?v=${encodeURIComponent(video.youtube_id)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-youtube px-4 py-2 text-sm font-semibold text-youtube-foreground transition hover:opacity-90"
              >
                <Play className="size-4 fill-current" />
                Watch on YouTube
                <ExternalLink className="size-3.5" />
              </a>
            </div>
          ) : (
            <YouTubePlayer
              src={src}
              poster={poster || undefined}
              sources={renditions}
              onFirstPlay={countView}
              className="sm:rounded-xl"
            />
          )}

          {video.status === "processing" && (
            <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
              <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin" />
              <span>
                {isOwner
                  ? "Still uploading — you're watching your local copy. It'll be available to everyone the moment it finishes."
                  : "This video is still being uploaded by its owner. This page updates automatically."}
              </span>
            </div>
          )}

          <div className="px-3 pt-3">
            <h1 className="text-[17px] font-bold leading-snug">{video.title}</h1>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <Link
                to="/u/$username"
                params={{ username: video.username }}
                className="flex min-w-0 items-center gap-2"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold uppercase text-primary-foreground">
                  {video.username?.[0] ?? "?"}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">@{video.username}</span>
                  <span className="block text-[12px] text-muted-foreground">
                    {formatViews(video.views)} · {timeAgo(video.created_at)}
                  </span>
                </span>
              </Link>

              {!isOwner && (
                <button
                  type="button"
                  onClick={() => void toggleSubscribe()}
                  className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${
                    subscribed
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-red-600 text-white hover:bg-red-700"
                  }`}
                >
                  {subscribed ? (
                    <span className="flex items-center gap-1">
                      <Check className="h-4 w-4" /> Following
                    </span>
                  ) : (
                    "Follow"
                  )}
                </button>
              )}
            </div>

            {/* Action row */}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <div className="flex items-center overflow-hidden rounded-full bg-secondary">
                <button
                  type="button"
                  onClick={() => void react("like")}
                  aria-pressed={myReaction === "like"}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${
                    myReaction === "like" ? "text-red-500" : "text-secondary-foreground"
                  }`}
                >
                  <ThumbsUp className={`h-4 w-4 ${myReaction === "like" ? "fill-current" : ""}`} />
                  {likes > 0 && likes}
                </button>
                <span className="h-5 w-px bg-border" />
                <button
                  type="button"
                  onClick={() => void react("dislike")}
                  aria-pressed={myReaction === "dislike"}
                  className={`flex items-center gap-1.5 px-3 py-2 text-sm font-semibold ${
                    myReaction === "dislike" ? "text-red-500" : "text-secondary-foreground"
                  }`}
                >
                  <ThumbsDown
                    className={`h-4 w-4 ${myReaction === "dislike" ? "fill-current" : ""}`}
                  />
                  {dislikes > 0 && dislikes}
                </button>
              </div>

              {isOwner && (
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"
                >
                  <Pencil className="h-4 w-4" /> Edit
                </button>
              )}
              <button
                type="button"
                onClick={() => setShareOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"
              >
                <Share2 className="h-4 w-4" /> Share
              </button>
              <button
                type="button"
                onClick={toggleSave}
                aria-pressed={saved}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition ${
                  saved ? "bg-yellow-400 text-black" : "bg-secondary text-secondary-foreground"
                }`}
              >
                <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} />
                {saved ? "Saved" : "Save"}
              </button>
              <button
                type="button"
                onClick={() => void offline.toggle()}
                disabled={offline.progress !== null || video.is_youtube}
                aria-pressed={offline.isSaved}
                aria-label={
                  offline.isSaved
                    ? `Remove from offline${offline.savedSize ? ` (${formatBytes(offline.savedSize)})` : ""}`
                    : "Download for offline"
                }
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition disabled:opacity-80 ${
                  offline.isSaved
                    ? "bg-emerald-600 text-white"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                {offline.progress !== null ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : offline.isSaved ? (
                  <Check className="h-4 w-4" />
                ) : offline.offlineUnlocked ? (
                  <Download className="h-4 w-4" />
                ) : (
                  <Lock className="h-4 w-4" />
                )}
                {offline.progress !== null
                  ? `Saving ${offline.progress}%`
                  : offline.isSaved
                    ? "Offline"
                    : offline.offlineUnlocked
                      ? offline.trialActive
                        ? offline.trialLabel
                        : "Download"
                      : offlinePlan().label}
              </button>
              <button
                type="button"
                onClick={repost}
                className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"
              >
                <Repeat2 className="h-4 w-4" /> Repost
              </button>
            </div>

            {video.description && (
              <div className="mt-3 rounded-xl bg-secondary p-3">
                <p className="whitespace-pre-wrap text-sm text-secondary-foreground">
                  {video.description}
                </p>
                {video.tags?.length > 0 && (
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    {video.tags.map((t) => `#${t}`).join(" ")}
                  </p>
                )}
              </div>
            )}

            {/* Comments — a list below the player, not an overlay. */}
            <section className="mt-5">
              <h2 className="text-sm font-bold">{comments.length} Comments</h2>

              {commentGif && (
                <div className="relative mt-2 inline-block">
                  <img src={commentGif} alt="Selected GIF" className="max-h-32 rounded-lg" />
                  {commentGifCredit && (
                    <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
                      Made by {commentGifCredit}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setCommentGif(null);
                      setCommentGifCredit(null);
                    }}
                    aria-label="Remove GIF"
                    className="absolute right-1 top-1 rounded-full bg-background/80 p-1"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              {showGifs && (
                <GifPicker
                  className="mt-2 rounded-xl bg-secondary/40"
                  onPick={(url, meta) => {
                    setCommentGif(url);
                    setCommentGifCredit(meta?.username ? `@${meta.username}` : null);
                    setShowGifs(false);
                  }}
                  onClose={() => setShowGifs(false)}
                />
              )}
              <form onSubmit={submitComment} className="mt-2 flex items-start gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={
                    replyTo
                      ? `Reply to @${replyTo.username}…`
                      : auth.user
                        ? "Add a comment…"
                        : "Sign in to comment"
                  }
                  aria-label="Add a comment"
                  className="min-w-0 flex-1 border-b bg-transparent pb-1 text-sm outline-none focus:border-foreground"
                />
                <button
                  type="button"
                  onClick={() => setShowGifs((v) => !v)}
                  aria-pressed={showGifs}
                  className="rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold"
                >
                  GIF
                </button>
                <button
                  type="submit"
                  disabled={(!commentText.trim() && !commentGif) || posting}
                  className="rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                >
                  {posting ? "Posting…" : replyTo ? "Reply" : "Comment"}
                </button>
              </form>

              {replyTo && (
                <div className="mt-1.5 flex items-center justify-between text-[12px] text-muted-foreground">
                  <span>Replying to @{replyTo.username}</span>
                  <button
                    type="button"
                    onClick={() => setReplyTo(null)}
                    aria-label="Cancel reply"
                    className="flex items-center gap-0.5 font-semibold hover:text-foreground"
                  >
                    <X className="h-3 w-3" /> Cancel
                  </button>
                </div>
              )}

              <ul className="mt-4 space-y-4">
                {comments
                  .filter((c) => !c.parent_id)
                  .map((c) => (
                    <li key={c.id}>
                      <CommentRow
                        comment={c}
                        onReply={() => setReplyTo(c)}
                        onLike={() => void likeComment(c)}
                      />
                      {comments
                        .filter((r) => r.parent_id === c.id)
                        .slice()
                        .reverse()
                        .map((r) => (
                          <div key={r.id} className="mt-3 pl-10">
                            <CommentRow
                              comment={r}
                              onReply={() => setReplyTo(r)}
                              onLike={() => void likeComment(r)}
                            />
                          </div>
                        ))}
                    </li>
                  ))}
                {comments.length === 0 && (
                  <li className="text-sm text-muted-foreground">
                    No comments yet. Start the conversation.
                  </li>
                )}
              </ul>
            </section>
          </div>
        </div>

        {/* Up Next rail */}
        <aside className="mt-6 px-3 lg:mt-0">
          <h2 className="mb-2 text-sm font-bold">Up next</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
            {related.map((v) => (
              <FullVideoCard key={v.id} video={v} />
            ))}
            {related.length === 0 && (
              <p className="text-sm text-muted-foreground">No related videos yet.</p>
            )}
          </div>
        </aside>
      </div>

      {video && shareOpen && (
        <FullVideoShareMenu video={video} onClose={() => setShareOpen(false)} />
      )}

      {video && auth.user && (
        <EditFullVideoDialog
          video={video}
          userId={auth.user.id}
          open={editing}
          onClose={() => setEditing(false)}
          onSaved={setVideo}
          onDeleted={() => void navigate({ to: "/videos" })}
        />
      )}
    </div>
  );
}

/** One comment or reply, with a like toggle and a reply affordance. */
function CommentRow({
  comment,
  onReply,
  onLike,
}: {
  comment: FullVideoComment;
  onReply: () => void;
  onLike: () => void;
}) {
  const initial = (comment.username ?? "").trim().charAt(0).toUpperCase() || "?";

  return (
    <div className="flex gap-2">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
        {initial}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold">
          @{comment.username}{" "}
          <span className="font-normal text-muted-foreground">{timeAgo(comment.created_at)}</span>
        </p>
        {comment.body && (
          <p className="whitespace-pre-wrap break-words text-sm">{comment.body}</p>
        )}
        {comment.gif_url && (
          <>
            <img
              src={comment.gif_url}
              alt="GIF"
              loading="lazy"
              className="mt-1 max-h-40 rounded-lg"
            />
            {comment.gif_credit && (
              <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">
                Made by {comment.gif_credit}
              </p>
            )}
          </>
        )}

        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={onLike}
            aria-pressed={comment.liked_by_me}
            aria-label={comment.liked_by_me ? "Unlike comment" : "Like comment"}
            className={`flex items-center gap-1 text-[12px] font-semibold transition ${
              comment.liked_by_me ? "text-red-500" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <ThumbsUp className={`h-3.5 w-3.5 ${comment.liked_by_me ? "fill-current" : ""}`} />
            {comment.like_count > 0 ? comment.like_count : "Like"}
          </button>

          <button
            type="button"
            onClick={onReply}
            className="flex items-center gap-1 text-[12px] font-semibold text-muted-foreground hover:text-foreground"
          >
            <CornerDownRight className="h-3.5 w-3.5" /> Reply
          </button>
        </div>
      </div>
    </div>
  );
}
