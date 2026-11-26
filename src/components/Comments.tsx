import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CornerDownRight, Heart, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { notifyUser, profileIdForHandle } from "@/lib/notify";
import { ReportButton } from "@/components/ReportButton";
import { findHighlightedCommentId, type HighlightCommentTarget } from "@/lib/inboxNotifications";
import { GifGridSkeleton, ListRowSkeleton } from "@/components/Skeletons";

const GifPicker = lazy(() =>
  import("@/components/GifPicker").then((m) => ({ default: m.GifPicker })),
);

export type { HighlightCommentTarget };

type Comment = {
  id: string;
  username: string;
  body: string;
  created_at: string;
  gif_url: string | null;
  gif_credit: string | null;
  parent_id: string | null;
  /** Folded in after the comments load; not a column on `comments`. */
  like_count: number;
  liked_by_me: boolean;
};

const COLS = "id, username, body, created_at, gif_url, gif_credit, parent_id";
const COMMENTS_PAGE_SIZE = 10;

export function Comments({
  videoId,
  onClose,
  onAdded,
  highlightComment,
}: {
  videoId: string;
  onClose: () => void;
  onAdded: () => void;
  highlightComment?: HighlightCommentTarget | null;
}) {
  const [items, setItems] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [gif, setGif] = useState<string | null>(null);
  const [gifCredit, setGifCredit] = useState<string | null>(null);
  const [showGifs, setShowGifs] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const highlightedElRef = useRef<HTMLDivElement | null>(null);
  const commentsScrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const { handle, signIn, user } = useAuth();

  const fetchLikesForRows = useCallback(
    async (rows: Omit<Comment, "like_count" | "liked_by_me">[]): Promise<Comment[]> => {
      if (rows.length === 0) return [];
      const { data: likeRows, error: likeError } = await supabase
        .from("comment_likes")
        .select("comment_id, user_id")
        .in(
          "comment_id",
          rows.map((r) => r.id),
        );

      if (likeError) {
        return rows.map((r) => ({ ...r, like_count: 0, liked_by_me: false }));
      }

      const counts = new Map<string, number>();
      const mine = new Set<string>();
      for (const like of (likeRows ?? []) as { comment_id: string; user_id: string }[]) {
        counts.set(like.comment_id, (counts.get(like.comment_id) ?? 0) + 1);
        if (user?.id && like.user_id === user.id) mine.add(like.comment_id);
      }

      return rows.map((r) => ({
        ...r,
        like_count: counts.get(r.id) ?? 0,
        liked_by_me: mine.has(r.id),
      }));
    },
    [user?.id],
  );

  const load = useCallback(async () => {
    setLoadError(null);
    setItems(null);
    offsetRef.current = 0;
    setHasMore(false);
    const ordered = supabase
      .from("comments")
      .select(COLS)
      .eq("video_id", videoId)
      .order("created_at", { ascending: false });
    const hasRange = typeof (ordered as unknown as { range?: unknown }).range === "function";
    const { data, error } = hasRange
      ? await (ordered as unknown as { range: (from: number, to: number) => typeof ordered }).range(
          0,
          COMMENTS_PAGE_SIZE - 1,
        )
      : await ordered;
    if (error) {
      // An empty list and a failed query used to look identical ("No comments
      // yet"), which hid real RLS/network failures. Surface it instead.
      setLoadError(error.message);
      setItems([]);
      return;
    }

    const rows = (data ?? []) as Omit<Comment, "like_count" | "liked_by_me">[];
    offsetRef.current = rows.length;
    setHasMore(hasRange && rows.length === COMMENTS_PAGE_SIZE);
    if (rows.length === 0) {
      setItems([]);
      return;
    }

    setItems(await fetchLikesForRows(rows));
  }, [videoId, fetchLikesForRows]);

  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const offset = offsetRef.current;
      const ordered = supabase
        .from("comments")
        .select(COLS)
        .eq("video_id", videoId)
        .order("created_at", { ascending: false });
      const hasRange = typeof (ordered as unknown as { range?: unknown }).range === "function";
      const { data, error } = hasRange
        ? await (
            ordered as unknown as { range: (from: number, to: number) => typeof ordered }
          ).range(offset, offset + COMMENTS_PAGE_SIZE - 1)
        : await ordered;
      if (error) return;
      const rows = (data ?? []) as Omit<Comment, "like_count" | "liked_by_me">[];
      offsetRef.current = offset + rows.length;
      setHasMore(hasRange && rows.length === COMMENTS_PAGE_SIZE);
      if (rows.length === 0) return;
      const enriched = await fetchLikesForRows(rows);
      setItems((prev) => {
        const cur = prev ?? [];
        const seen = new Set(cur.map((x) => x.id));
        return [...cur, ...enriched.filter((r) => !seen.has(r.id))];
      });
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [videoId, hasMore, fetchLikesForRows]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const root = commentsScrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel || !hasMore || showGifs || typeof IntersectionObserver === "undefined") {
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { root, rootMargin: "120px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, showGifs, loadMore, items?.length]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body && !gif) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("comments")
      .insert({
        video_id: videoId,
        username: handle ?? "guest",
        body: body.slice(0, 300),
        gif_url: gif,
        gif_credit: gifCredit,
        parent_id: replyTo ? (replyTo.parent_id ?? replyTo.id) : null,
      })
      .select(COLS)
      .single();
    setBusy(false);
    if (error) {
      console.error("comment insert failed", error);
      toast.error(`Couldn't post comment: ${error.message}`);
      return;
    }
    setItems((c) => [{ ...data, like_count: 0, liked_by_me: false }, ...(c ?? [])]);
    setText("");

    setGif(null);
    setGifCredit(null);
    setShowGifs(false);
    setReplyTo(null);
    onAdded();

    // Let the video owner know — in the bell and on their phone.
    void (async () => {
      try {
        if (!user?.id) return;
        const { data: video } = await supabase
          .from("videos")
          .select("username")
          .eq("id", videoId)
          .maybeSingle();
        if (!video?.username) return;
        const ownerId = await profileIdForHandle(video.username);
        if (!ownerId) return;
        await notifyUser({
          targetUserId: ownerId,
          actorUserId: user.id,
          type: "comment",
          videoId,
          text: `${handle ?? "Someone"} commented: ${body.slice(0, 80)}`,
          url: "/",
        });
      } catch {
        // Notifications are best-effort; the comment itself already saved.
      }
    })();
  };

  const topLevel = items?.filter((c) => !c.parent_id) ?? [];
  const repliesTo = (id: string) => (items ?? []).filter((r) => r.parent_id === id).reverse();
  const highlightedId = useMemo(
    () => (items ? findHighlightedCommentId(items, highlightComment) : null),
    [items, highlightComment],
  );

  useEffect(() => {
    if (!highlightedId || showGifs) return;
    const el = highlightedElRef.current;
    if (el && typeof el.scrollIntoView === "function") {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [highlightedId, showGifs]);

  /** Optimistically flip a comment's like, then settle on the server value. */
  const likeComment = async (comment: Comment) => {
    if (!user?.id) {
      void signIn();
      return;
    }
    const nextLiked = !comment.liked_by_me;

    setItems((list) =>
      (list ?? []).map((c) =>
        c.id === comment.id
          ? {
              ...c,
              liked_by_me: nextLiked,
              like_count: Math.max(0, c.like_count + (nextLiked ? 1 : -1)),
            }
          : c,
      ),
    );

    try {
      if (nextLiked) {
        const { error } = await supabase
          .from("comment_likes")
          .insert({ comment_id: comment.id, user_id: user.id });
        // 23505 = already liked; treat as success.
        if (error && error.code !== "23505") throw error;
      } else {
        const { error } = await supabase
          .from("comment_likes")
          .delete()
          .eq("comment_id", comment.id)
          .eq("user_id", user.id);
        if (error) throw error;
      }
    } catch {
      // Put it back the way it was.
      setItems((list) =>
        (list ?? []).map((c) =>
          c.id === comment.id
            ? { ...c, liked_by_me: comment.liked_by_me, like_count: comment.like_count }
            : c,
        ),
      );
      toast.error("Couldn't save your like");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-end bg-overlay sm:items-stretch"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        className={`mobile-comments flex w-full max-w-md flex-col rounded-t-2xl border bg-card sm:h-full sm:rounded-none sm:border-l ${
          showGifs ? "h-[70dvh]" : "h-[75dvh]"
        }`}
      >
        <header className="flex items-center justify-between border-b p-4">
          <h2 className="font-bold">Comments {items ? `(${items.length})` : ""}</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        {/* While the GIF picker (or the GIF maker inside it) is open it takes
            the sheet's free space and the thread is hidden. Before this the
            two shared a flex column, so on a phone the maker was squeezed
            below the fold and its Create button could not be reached. */}
        {showGifs ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <Suspense fallback={<GifGridSkeleton className="p-3" />}>
              <GifPicker
                fill
                className="min-h-0 flex-1 overflow-hidden"
                onPick={(u, meta) => {
                  setGif(u);
                  setGifCredit(meta?.username ? `@${meta.username}` : null);
                  setShowGifs(false);
                }}
                onClose={() => setShowGifs(false)}
              />
            </Suspense>
          </div>
        ) : (
          <div ref={commentsScrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {items === null && <ListRowSkeleton count={4} />}
            {loadError && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Couldn't load comments: {loadError}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="rounded-full bg-secondary px-4 py-1.5 text-xs font-bold"
                >
                  Try again
                </button>
              </div>
            )}
            {!loadError && items?.length === 0 && (
              <p className="text-sm text-muted-foreground">No comments yet. Be the first.</p>
            )}
            {topLevel.map((c) => (
              <div key={c.id} className="space-y-3">
                <div ref={c.id === highlightedId ? highlightedElRef : undefined}>
                  <CommentRow
                    c={c}
                    videoId={videoId}
                    onReply={setReplyTo}
                    onLike={likeComment}
                    highlighted={c.id === highlightedId}
                  />
                </div>
                {repliesTo(c.id).map((r) => (
                  <div
                    key={r.id}
                    ref={r.id === highlightedId ? highlightedElRef : undefined}
                    className="ml-11"
                  >
                    <CommentRow
                      c={r}
                      videoId={videoId}
                      onReply={setReplyTo}
                      onLike={likeComment}
                      highlighted={r.id === highlightedId}
                    />
                  </div>
                ))}
              </div>
            ))}
            {hasMore && <div ref={sentinelRef} className="h-2 w-full" aria-hidden="true" />}
            {loadingMore && <ListRowSkeleton count={2} />}
          </div>
        )}
        {!handle ? (
          <div className="border-t p-4">
            <button
              onClick={signIn}
              className="w-full rounded-full bg-primary py-2.5 text-sm font-bold text-primary-foreground"
            >
              Sign in to comment
            </button>
          </div>
        ) : (
          <>
            {replyTo && (
              <div className="flex items-center justify-between border-t px-4 pt-3 text-xs text-muted-foreground">
                <span>Replying to @{replyTo.username}</span>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {gif && (
              <div className="relative border-t px-4 pt-3">
                <img src={gif} alt="Selected GIF" className="max-h-32 rounded-lg" />
                {gifCredit && (
                  <p className="mt-1 text-[10px] font-semibold text-muted-foreground">
                    Made by {gifCredit}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setGif(null);
                    setGifCredit(null);
                  }}
                  aria-label="Remove GIF"
                  className="absolute left-5 top-5 rounded-full bg-background/80 p-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {!showGifs && (
              <form onSubmit={submit} className="flex gap-2 border-t p-4">
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={300}
                  placeholder={replyTo ? `Reply to @${replyTo.username}…` : "Add a comment…"}
                  className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2 text-base outline-none focus:ring-2 focus:ring-ring sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGifs((v) => !v)}
                  className="rounded-full bg-secondary px-3 text-xs font-bold"
                >
                  GIF
                </button>
                <button
                  disabled={busy || (!text.trim() && !gif)}
                  className="rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
                >
                  Post
                </button>
              </form>
            )}
          </>
        )}
      </aside>
    </div>
  );
}

function CommentRow({
  c,
  videoId,
  onReply,
  onLike,
  highlighted = false,
}: {
  c: Comment;
  videoId: string;
  onReply: (c: Comment) => void;
  onLike: (c: Comment) => void;
  highlighted?: boolean;
}) {
  // `username` is NOT NULL in the database, but a trimmed empty string would
  // still make `c.username[0]` render nothing; fall back to "?".
  const initial = (c.username ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <div
      data-highlighted={highlighted ? "true" : undefined}
      className={`flex gap-3 transition-colors ${
        highlighted ? "-mx-2.5 rounded-xl bg-primary/15 px-2.5 py-2 ring-1 ring-primary/60" : ""
      }`}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold uppercase">
        {initial}
      </div>
      <div className="min-w-0 break-words">
        <p className="text-xs font-bold text-muted-foreground">@{c.username}</p>
        {c.body && <p className="text-sm">{c.body}</p>}
        {c.gif_url && (
          <>
            <img
              src={c.gif_url}
              alt="GIF"
              loading="lazy"
              decoding="async"
              className="mt-1 max-h-40 rounded-lg"
            />
            {c.gif_credit && (
              <p className="mt-0.5 text-[10px] font-semibold text-muted-foreground">
                Made by {c.gif_credit}
              </p>
            )}
          </>
        )}
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onLike(c)}
            aria-pressed={c.liked_by_me}
            aria-label={c.liked_by_me ? "Unlike comment" : "Like comment"}
            className={`flex items-center gap-1 text-xs font-semibold ${
              c.liked_by_me ? "text-red-500" : "text-muted-foreground"
            }`}
          >
            <Heart className={`h-3.5 w-3.5 ${c.liked_by_me ? "fill-current" : ""}`} />
            {c.like_count > 0 ? c.like_count : "Like"}
          </button>
          <button
            type="button"
            onClick={() => onReply(c)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"
          >
            <CornerDownRight className="h-3 w-3" /> Reply
          </button>
          <ReportButton
            username={c.username}
            videoId={videoId}
            commentId={c.id}
            target="comment"
            targetUrl={
              typeof window !== "undefined" ? `${window.location.origin}/v/${videoId}` : null
            }
            targetText={c.body?.trim() || (c.gif_url ? "[GIF comment]" : null)}
            thumbnailUrl={c.gif_url}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground"
            label="Report"
          />
        </div>
      </div>
    </div>
  );
}
