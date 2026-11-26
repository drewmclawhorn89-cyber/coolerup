import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownRight, Heart, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { notifyUser, profileIdForHandle } from "@/lib/notify";
import { ReportButton } from "@/components/ReportButton";
import { findHighlightedCommentId, type HighlightCommentTarget } from "@/lib/inboxNotifications";
import { GifGridSkeleton, ListRowSkeleton } from "@/components/Skeletons";
import { closeCommentsOverlay, openCommentsOverlay } from "@/lib/commentsOverlay";

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
  const [keyboardMetrics, setKeyboardMetrics] = useState<{
    bottomOffset: number;
    maxHeightPx: number | null;
  }>({ bottomOffset: 0, maxHeightPx: null });
  const highlightedElRef = useRef<HTMLDivElement | null>(null);
  const commentsScrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const offsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const { avatar, handle, signIn, user } = useAuth();

  // Hide the main bottom navigation whenever this sheet is mounted.
  useEffect(() => {
    openCommentsOverlay();
    return () => {
      closeCommentsOverlay();
    };
  }, []);

  // Track iOS / Android soft keyboard so the sheet & input bar stay cleanly above it.
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const vv = window.visualViewport;
    const updateViewport = () => {
      const bottomOffset = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      const maxHeightPx = bottomOffset > 0 ? Math.max(240, Math.round(vv.height - 8)) : null;
      setKeyboardMetrics({ bottomOffset, maxHeightPx });
    };
    updateViewport();
    vv.addEventListener("resize", updateViewport);
    vv.addEventListener("scroll", updateViewport);
    return () => {
      vv.removeEventListener("resize", updateViewport);
      vv.removeEventListener("scroll", updateViewport);
    };
  }, []);

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

  const userInitial = (handle ?? "").trim().charAt(0).toUpperCase() || "?";

  const content = (
    <div
      className="fixed inset-0 z-[90] bg-black/55"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Comments"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        onWheel={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--background)",
          bottom: keyboardMetrics.bottomOffset > 0 ? `${keyboardMetrics.bottomOffset}px` : "0px",
          maxHeight: keyboardMetrics.maxHeightPx ? `${keyboardMetrics.maxHeightPx}px` : undefined,
        }}
        className="mobile-comments sheet-up fixed bottom-0 left-0 z-[91] flex h-[70dvh] w-screen flex-col overflow-hidden rounded-t-2xl border-t border-white/20 bg-background text-white sm:left-auto sm:right-0 sm:top-0 sm:h-dvh sm:w-full sm:max-w-md sm:rounded-none sm:border-l sm:border-t-0"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-white/20 px-4 py-3.5">
          <h2 className="text-base font-bold text-white">
            Comments {items ? `(${items.length})` : ""}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-full text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

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
          <div
            ref={commentsScrollRef}
            className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4"
          >
            {items === null && <ListRowSkeleton count={4} />}
            {loadError && (
              <div className="space-y-2">
                <p className="text-sm text-white/80">Couldn't load comments: {loadError}</p>
                <button
                  type="button"
                  onClick={() => void load()}
                  className="rounded-full bg-white px-4 py-1.5 text-xs font-bold text-black"
                >
                  Try again
                </button>
              </div>
            )}
            {!loadError && items?.length === 0 && (
              <p className="text-sm text-white/75">No comments yet. Be the first.</p>
            )}
            {topLevel.map((c) => (
              <div key={c.id} className="space-y-3">
                <div ref={c.id === highlightedId ? highlightedElRef : undefined}>
                  <CommentRow
                    c={c}
                    videoId={videoId}
                    onReply={(target) => {
                      setReplyTo(target);
                      inputRef.current?.focus();
                    }}
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
                      onReply={(target) => {
                        setReplyTo(target);
                        inputRef.current?.focus();
                      }}
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
          <div
            style={{
              backgroundColor: "var(--background)",
              paddingBottom:
                keyboardMetrics.bottomOffset > 0
                  ? "12px"
                  : "calc(env(safe-area-inset-bottom) + 12px)",
            }}
            className="shrink-0 border-t border-white/20 bg-background px-3 pt-3"
          >
            <button
              type="button"
              onClick={signIn}
              className="w-full rounded-full bg-white py-2.5 text-sm font-bold text-black"
            >
              Sign in to comment
            </button>
          </div>
        ) : (
          <div style={{ backgroundColor: "var(--background)" }} className="shrink-0 bg-background">
            {replyTo && (
              <div className="flex items-center justify-between border-t border-white/20 px-4 pt-2.5 text-xs text-white/80">
                <span>Replying to @{replyTo.username}</span>
                <button
                  type="button"
                  onClick={() => setReplyTo(null)}
                  aria-label="Cancel reply"
                  className="text-white"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            {gif && (
              <div className="relative border-t border-white/20 px-4 pt-2.5">
                <img src={gif} alt="Selected GIF" className="max-h-32 rounded-lg" />
                {gifCredit && (
                  <p className="mt-1 text-[10px] font-semibold text-white/75">
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
                  className="absolute left-5 top-4 rounded-full bg-black/80 p-1 text-white"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
            {!showGifs && (
              <form
                onSubmit={submit}
                style={{
                  paddingBottom:
                    keyboardMetrics.bottomOffset > 0
                      ? "12px"
                      : "calc(env(safe-area-inset-bottom) + 12px)",
                }}
                className="flex items-center gap-2 border-t border-white/20 px-3 pt-3"
              >
                <div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/25 bg-white/15 text-xs font-bold uppercase text-white">
                  {avatar ? (
                    <img
                      src={avatar}
                      alt={handle ? `@${handle}` : "Your profile"}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    userInitial
                  )}
                </div>
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onFocus={() => {
                    if (typeof window !== "undefined") {
                      window.scrollTo(0, 0);
                    }
                  }}
                  maxLength={300}
                  placeholder={replyTo ? `Reply to @${replyTo.username}…` : "Add a comment…"}
                  className="h-10 min-w-0 flex-1 rounded-full border border-white/25 bg-white/15 px-4 text-base text-white placeholder:text-white/65 outline-none sm:text-sm"
                />
                <button
                  type="button"
                  onClick={() => setShowGifs((v) => !v)}
                  className="flex h-10 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 px-3 text-xs font-bold text-white"
                >
                  GIF
                </button>
                <button
                  type="submit"
                  disabled={busy || (!text.trim() && !gif)}
                  className="flex h-10 shrink-0 items-center justify-center rounded-full bg-white px-4 text-sm font-bold text-black disabled:opacity-50"
                >
                  Post
                </button>
              </form>
            )}
          </div>
        )}
      </aside>
    </div>
  );

  if (typeof document !== "undefined" && document.body) {
    return createPortal(content, document.body);
  }
  return content;
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
      className={`flex items-start gap-3 ${
        highlighted ? "-mx-2.5 rounded-xl bg-white/15 px-2.5 py-2 ring-1 ring-white/60" : ""
      }`}
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/25 bg-white/15 text-xs font-bold uppercase text-white">
        {initial}
      </div>
      <div className="min-w-0 flex-1 break-words">
        <p className="text-xs font-bold text-white/80">@{c.username}</p>
        {c.body && <p className="mt-0.5 text-sm leading-snug text-white">{c.body}</p>}
        {c.gif_url && (
          <>
            <img
              src={c.gif_url}
              alt="GIF"
              loading="lazy"
              decoding="async"
              className="mt-1.5 max-h-40 rounded-lg"
            />
            {c.gif_credit && (
              <p className="mt-0.5 text-[10px] font-semibold text-white/75">
                Made by {c.gif_credit}
              </p>
            )}
          </>
        )}
        <div className="mt-1.5 flex items-center gap-4">
          <button
            type="button"
            onClick={() => onLike(c)}
            aria-pressed={c.liked_by_me}
            aria-label={c.liked_by_me ? "Unlike comment" : "Like comment"}
            className={`flex items-center gap-1 text-xs font-semibold ${
              c.liked_by_me ? "text-[#FE2C55]" : "text-white/80"
            }`}
          >
            <Heart className={`h-3.5 w-3.5 ${c.liked_by_me ? "fill-current" : ""}`} />
            {c.like_count > 0 ? c.like_count : "Like"}
          </button>
          <button
            type="button"
            onClick={() => onReply(c)}
            className="flex items-center gap-1 text-xs font-semibold text-white/80"
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
            className="flex items-center gap-1 text-xs font-semibold text-white/80"
            label="Report"
          />
        </div>
      </div>
    </div>
  );
}
