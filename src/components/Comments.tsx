import { useEffect, useState } from "react";
import { CornerDownRight, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

type Comment = {
  id: string;
  username: string;
  body: string;
  created_at: string;
  gif_url: string | null;
  parent_id: string | null;
};

const COLS = "id, username, body, created_at, gif_url, parent_id";
const GIPHY_KEY = (import.meta.env.VITE_GIPHY_API_KEY as string | undefined) ?? "";

type Gif = { id: string; url: string; preview: string };

function GifPicker({ onPick, onClose }: { onPick: (url: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [gifs, setGifs] = useState<Gif[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!GIPHY_KEY) {
        toast.error("GIFs need a Giphy API key (VITE_GIPHY_API_KEY)");
        return;
      }
      setLoading(true);
      try {
        const base = q.trim() ? "search" : "trending";
        const params = new URLSearchParams({ api_key: GIPHY_KEY, limit: "24", rating: "pg-13" });
        if (q.trim()) params.set("q", q.trim());
        const res = await fetch(`https://api.giphy.com/v1/gifs/${base}?${params}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.meta?.msg ?? `HTTP ${res.status}`);
        setGifs(
          (json.data ?? []).map((g: any) => ({
            id: g.id,
            url: g.images.fixed_height.url,
            preview: g.images.fixed_height_small?.url ?? g.images.fixed_height.url,
          })),
        );
      } catch (err) {
        toast.error(`Couldn't load GIFs: ${err instanceof Error ? err.message : "unknown error"}`);
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
            <img src={g.preview} alt="GIF" loading="lazy" className="h-20 w-full rounded object-cover" />
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
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [gif, setGif] = useState<string | null>(null);
  const [showGifs, setShowGifs] = useState(false);
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const { handle, signIn } = useAuth();

  useEffect(() => {
    supabase
      .from("comments")
      .select(COLS)
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setItems(data ?? []));
  }, [videoId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body && !gif) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("comments")
      .insert({ video_id: videoId, username: handle ?? "guest",
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
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-overlay sm:items-stretch" onClick={onClose}>
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
          {items?.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet. Be the first.</p>
          )}
          {items
            ?.filter((c) => !c.parent_id)
            .map((c) => (
              <div key={c.id} className="space-y-3">
                <CommentRow c={c} onReply={setReplyTo} />
                {items
                  .filter((r) => r.parent_id === c.id)
                  .reverse()
                  .map((r) => (
                    <div key={r.id} className="ml-11">
                      <CommentRow c={r} onReply={setReplyTo} />
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

function CommentRow({ c, onReply }: { c: Comment; onReply: (c: Comment) => void }) {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold uppercase">
        {c.username[0]}
      </div>
      <div className="min-w-0 break-words">
        <p className="text-xs font-bold text-muted-foreground">@{c.username}</p>
        {c.body && <p className="text-sm">{c.body}</p>}
        {c.gif_url && <img src={c.gif_url} alt="GIF" loading="lazy" className="mt-1 max-h-40 rounded-lg" />}
        <button
          onClick={() => onReply(c)}
          className="mt-1 flex items-center gap-1 text-xs font-semibold text-muted-foreground"
        >
          <CornerDownRight className="h-3 w-3" /> Reply
        </button>
      </div>
    </div>
  );
}
