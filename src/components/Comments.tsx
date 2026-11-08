import { useCallback, useEffect, useState } from "react";
import { CornerDownRight, Heart, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { notifyUser, profileIdForHandle } from "@/lib/notify";

type Comment = {
  id: string;
  username: string;
  body: string;
  created_at: string;
  gif_url: string | null;
  parent_id: string | null;
  /** Folded in after the comments load; not a column on `comments`. */
  like_count: number;
  liked_by_me: boolean;
};

const COLS = "id, username, body, created_at, gif_url, parent_id";
// Bracket access: `import.meta.env` is typed with an index signature, so
// `env.VITE_GIPHY_API_KEY` fails `tsc --noEmit` (TS4111).
const GIPHY_KEY = (import.meta.env["VITE_GIPHY_API_KEY"] as string | undefined) ?? "dc6zaTOxFJmzC";

type Gif = { id: string; url: string; preview: string };

type GiphyImage = { url?: string };
type GiphyResult = {
  id?: string;
  images?: {
    fixed_height?: GiphyImage;
    fixed_height_small?: GiphyImage;
  };
};

function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const base = q.trim() ? "search" : "trending";
        const params = new URLSearchParams({ api_key: GIPHY_KEY, limit: "24", rating: "pg-13" });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`https://api.giphy.com/v1/gifs/${base}?${params}`);
        if (!res.ok) throw new Error(`Giphy responded ${res.status}`);
        const json = (await res.json()) as { data?: GiphyResult[] };
        // A GIF without a fixed_height rendition can't be shown, so skip it
        // rather than rendering a broken <img>.
        setGifs(
          (json.data ?? []).flatMap((g) => {
            const url = g.images?.fixed_height?.url;
            if (!g.id || !url) return [];
            return [{ id: g.id, url, preview: g.images?.fixed_height_small?.url ?? url }];
          }),
        );
      } catch {
        toast.error("Couldn't load GIFs");
      }
      setLoading(false);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="border-t p-3">
      <div className="mb-2 flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search GIFs…"
          className="min-w-0 flex-1 rounded-full bg-secondary px-4 py-2 text-base outline-none sm:text-sm"
        />
        <button type="button" onClick={onClose} aria-label="Close GIF picker">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto">
        {loading && <p className="col-span-3 text-xs text-muted-foreground">Loading…</p>}
        {gifs.map((g) => (
          <button type="button" key={g.id} onClick={() => onPick(g.url)}>
            <img
              src={g.preview}
              alt="GIF"
              loading="lazy"
              className="h-20 w-full rounded object-cover"
            />
          </button>
        ))}
      </div>
    </div>
  );
}

export function Comments({
  videoId,
  onClose,
  onAdded,
}: {
  videoId: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [items, setItems] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [gif, setGif] = useState<string | null>(null);
  const [showGifs, setShowGifs] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const { handle, signIn, user } = useAuth();

  const load = useCallback(async () => {
    setLoadError(null);
    setItems(null);
    const { data, error } = await supabase
      .from("comments")
      .select(COLS)
      .eq("video_id", videoId)
      .order("created_at", { ascending: false });
    if (error) {
      // An empty list and a failed query used to look identical ("No comments
      // yet"), which hid real RLS/network failures. Surface it instead.
      setLoadError(error.message);
      setItems([]);
      return;
    }

    const rows = (data ?? []) as Omit<Comment, "like_count" | "liked_by_me">[];
    if (rows.length === 0) {
      setItems([]);
      return;
    }

    // One extra query for every like on the thread, then fold the counts in.
    // A missing table (migration not applied yet) must not blank the thread.
    const { data: likeRows, error: likeError } = await supabase
      .from("comment_likes")
      .select("comment_id, user_id")
      .in(
        "comment_id",
        rows.map((r) => r.id),
      );

    if (likeError) {
      setItems(rows.map((r) => ({ ...r, like_count: 0, liked_by_me: false })));
      return;
    }

    const counts = new Map<string, number>();
    const mine = new Set<string>();
    for (const like of (likeRows ?? []) as { comment_id: string; user_id: string }[]) {
      counts.set(like.comment_id, (counts.get(like.comment_id) ?? 0) + 1);
      if (user?.id && like.user_id === user.id) mine.add(like.comment_id);
    }

    setItems(
      rows.map((r) => ({
        ...r,
        like_count: counts.get(r.id) ?? 0,
        liked_by_me: mine.has(r.id),
      })),
    );
  }, [videoId, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

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
    setItems((c) => [data, ...(c ?? [])]);
    setText("");
    setGif(null);
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
        className="mobile-comments flex h-[75dvh] w-full max-w-md flex-col rounded-t-2xl border bg-card sm:h-full sm:rounded-none sm:border-l"
      >
        <header className="flex items-center justify-between border-b p-4">
          <h2 className="font-bold">Comments {items ? `(${items.length})` : ""}</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {items === null && <p className="text-sm text-muted-foreground">Loading…</p>}
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
              <CommentRow c={c} onReply={setReplyTo} onLike={likeComment} />
              {repliesTo(c.id).map((r) => (
                <div key={r.id} className="ml-11">
                  <CommentRow c={r} onReply={setReplyTo} onLike={likeComment} />
                </div>
              ))}
            </div>
          ))}
        </div>
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
            {showGifs && (
              <GifPicker
                onPick={(u) => {
                  setGif(u);
                  setShowGifs(false);
                }}
                onClose={() => setShowGifs(false)}
              />
            )}
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
                <button
                  type="button"
                  onClick={() => setGif(null)}
                  aria-label="Remove GIF"
                  className="absolute left-5 top-5 rounded-full bg-background/80 p-1"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}
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
          </>
        )}
      </aside>
    </div>
  );
}

function CommentRow({
  c,
  onReply,
  onLike,
}: {
  c: Comment;
  onReply: (c: Comment) => void;
  onLike: (c: Comment) => void;
}) {
  // `username` is NOT NULL in the database, but a trimmed empty string would
  // still make `c.username[0]` render nothing; fall back to "?".
  const initial = (c.username ?? "").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold uppercase">
        {initial}
      </div>
      <div className="min-w-0 break-words">
        <p className="text-xs font-bold text-muted-foreground">@{c.username}</p>
        {c.body && <p className="text-sm">{c.body}</p>}
        {c.gif_url && (
          <img src={c.gif_url} alt="GIF" loading="lazy" className="mt-1 max-h-40 rounded-lg" />
        )}
        <div className="mt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={() => onLike(c)}
            aria-pressed={c.liked_by_me}
            aria-label={c.liked_by_me ? "Unlike comment" : "Like comment"}
            className={`flex items-center gap-1 text-xs font-semibold transition ${
              c.liked_by_me ? "text-red-500" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Heart className={`h-3.5 w-3.5 ${c.liked_by_me ? "fill-current" : ""}`} />
            {c.like_count > 0 ? c.like_count : "Like"}
          </button>
          <button
            type="button"
            onClick={() => onReply(c)}
            className="flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            <CornerDownRight className="h-3 w-3" /> Reply
          </button>
        </div>
      </div>
    </div>
  );
}
