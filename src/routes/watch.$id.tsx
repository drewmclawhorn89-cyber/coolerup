import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  Check,
  Loader2,
  Pencil,
  Repeat2,
  Share2,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
import { toast } from "sonner";
import { YouTubePlayer } from "@/components/YouTubePlayer";
import { EditFullVideoDialog } from "@/components/EditFullVideoDialog";
import { FullVideoCard } from "@/components/FullVideoCard";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { getPendingVideo } from "@/lib/pendingUploads";
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
  const [saved, setSaved] = useState(false);
  const [editing, setEditing] = useState(false);

  const [comments, setComments] = useState<FullVideoComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [posting, setPosting] = useState(false);

  const viewCounted = useRef(false);

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

        const rows = await listComments(row.id);
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
  const waitingForUpload =
    video?.status === "processing" && !getPendingVideo(video.id);

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

  const share = async () => {
    const url = `${window.location.origin}/watch/${id}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: video?.title ?? "Coolerup video", url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied");
      }
    } catch {
      /* user dismissed the share sheet */
    }
  };

  const toggleSave = () => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    // Read the next value, not the stale one — otherwise the toast announces
    // the opposite of what just happened.
    const next = !saved;
    setSaved(next);
    toast.success(next ? "Saved to Vault" : "Removed from Vault");
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
    if (!body || !video) return;

    setPosting(true);
    try {
      const row = await addComment(
        video.id,
        auth.user.id,
        auth.handle ?? auth.name ?? "you",
        body,
      );
      setComments((c) => [row, ...c]);
      setCommentText("");
    } catch {
      toast.error("Could not post your comment.");
    } finally {
      setPosting(false);
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
                    <Check className="h-4 w-4" /> Subscribed
                  </span>
                ) : (
                  "Subscribe"
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
                  <ThumbsDown className={`h-4 w-4 ${myReaction === "dislike" ? "fill-current" : ""}`} />
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
                onClick={() => void share()}
                className="flex items-center gap-1.5 rounded-full bg-secondary px-3 py-2 text-sm font-semibold text-secondary-foreground"
              >
                <Share2 className="h-4 w-4" /> Share
              </button>
              <button
                type="button"
                onClick={toggleSave}
                aria-pressed={saved}
                className={`flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-semibold transition ${
                  saved
                    ? "bg-yellow-400 text-black"
                    : "bg-secondary text-secondary-foreground"
                }`}
              >
                <Bookmark className={`h-4 w-4 ${saved ? "fill-current" : ""}`} />
                {saved ? "Saved" : "Save"}
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

              <form onSubmit={submitComment} className="mt-2 flex items-start gap-2">
                <input
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={auth.user ? "Add a comment…" : "Sign in to comment"}
                  aria-label="Add a comment"
                  className="min-w-0 flex-1 border-b bg-transparent pb-1 text-sm outline-none focus:border-foreground"
                />
                <button
                  type="submit"
                  disabled={!commentText.trim() || posting}
                  className="rounded-full bg-secondary px-3 py-1.5 text-sm font-semibold disabled:opacity-50"
                >
                  {posting ? "Posting…" : "Comment"}
                </button>
              </form>

              <ul className="mt-4 space-y-4">
                {comments.map((c) => (
                  <li key={c.id} className="flex gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-bold uppercase">
                      {c.username?.[0] ?? "?"}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold">
                        @{c.username}{" "}
                        <span className="font-normal text-muted-foreground">
                          {timeAgo(c.created_at)}
                        </span>
                      </p>
                      <p className="whitespace-pre-wrap break-words text-sm">{c.body}</p>
                    </div>
                  </li>
                ))}
                {comments.length === 0 && (
                  <li className="text-sm text-muted-foreground">No comments yet. Start the conversation.</li>
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
