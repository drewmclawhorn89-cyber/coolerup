import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ME } from "@/lib/loop";

type Comment = { id: string; username: string; body: string; created_at: string };

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

  useEffect(() => {
    supabase
      .from("comments")
      .select("id, username, body, created_at")
      .eq("video_id", videoId)
      .order("created_at", { ascending: false })
      .then(({ data }) => setItems(data ?? []));
  }, [videoId]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setBusy(true);
    const { data, error } = await supabase
      .from("comments")
      .insert({ video_id: videoId, username: ME, body: body.slice(0, 300) })
      .select("id, username, body, created_at")
      .single();
    setBusy(false);
    if (error) {
      toast.error("Couldn't post comment");
      return;
    }
    setItems((c) => [data, ...(c ?? [])]);
    setText("");
    onAdded();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-overlay" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-md flex-col border-l bg-card"
      >
        <header className="flex items-center justify-between border-b p-4">
          <h2 className="font-bold">Comments {items ? `(${items.length})` : ""}</h2>
          <button onClick={onClose} aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>
        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {items === null && <p className="text-sm text-muted-foreground">Loading…</p>}
          {items?.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments yet. Be the first.</p>
          )}
          {items?.map((c) => (
            <div key={c.id} className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-bold uppercase">
                {c.username[0]}
              </div>
              <div>
                <p className="text-xs font-bold text-muted-foreground">@{c.username}</p>
                <p className="text-sm">{c.body}</p>
              </div>
            </div>
          ))}
        </div>
        <form onSubmit={submit} className="flex gap-2 border-t p-4">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            placeholder="Add a comment…"
            className="flex-1 rounded-full bg-secondary px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            disabled={busy || !text.trim()}
            className="rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground disabled:opacity-50"
          >
            Post
          </button>
        </form>
      </aside>
    </div>
  );
}
