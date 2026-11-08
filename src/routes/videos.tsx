import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Loader2, Search, Upload } from "lucide-react";
import { FullVideoCard } from "@/components/FullVideoCard";
import { EditFullVideoDialog } from "@/components/EditFullVideoDialog";
import { useAuth } from "@/hooks/useAuth";
import {
  FULL_VIDEO_CATEGORIES,
  listFullVideos,
  type FullVideo,
} from "@/lib/fullVideos";

export const Route = createFileRoute("/videos")({
  head: () => ({
    meta: [
      { title: "Videos — Coolerup" },
      {
        name: "description",
        content: "Watch full-length videos on Coolerup — music, gaming, comedy and more.",
      },
      { property: "og:title", content: "Videos — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: VideosPage,
});

function VideosPage() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [category, setCategory] = useState<string>("All");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [videos, setVideos] = useState<FullVideo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FullVideo | null>(null);

  // Debounce typing so we don't hit the API on every keystroke.
  useEffect(() => {
    const t = window.setTimeout(() => setSearch(searchInput.trim()), 350);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // `viewerId` keeps in-flight uploads visible to their owner only.
      setVideos(await listFullVideos({ category, search, viewerId: auth.user?.id ?? null }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load videos.");
    } finally {
      setLoading(false);
    }
  }, [category, search, auth.user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  const startUpload = () => {
    if (!auth.user) {
      void auth.signIn();
      return;
    }
    void navigate({ to: "/upload-full" });
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-3 pb-24 pt-3">
      {/* Search bar, YouTube style: a wide rounded field with the icon inside. */}
      <div className="sticky top-0 z-20 -mx-3 bg-background/95 px-3 pb-2 pt-1 backdrop-blur">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
          }}
          className="flex items-center gap-2"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-full border bg-card px-3 py-2">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search full videos"
              aria-label="Search full videos"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            onClick={startUpload}
            aria-label="Upload a full video"
            className="flex shrink-0 items-center gap-1 rounded-full create-pink px-3 py-2 text-sm font-semibold"
          >
            <Upload className="h-4 w-4" />
            <span className="hidden sm:inline">Upload</span>
          </button>
        </form>

        {/* Category chips */}
        <div className="-mx-3 mt-2 flex gap-2 overflow-x-auto px-3 pb-1 no-scrollbar">
          {FULL_VIDEO_CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategory(c)}
              aria-pressed={category === c}
              className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition ${
                category === c
                  ? "bg-foreground text-background"
                  : "bg-secondary text-secondary-foreground hover:bg-accent"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : videos.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-base font-semibold">No videos here yet</p>
          <p className="mt-1 max-w-xs text-sm text-muted-foreground">
            {search
              ? `Nothing matched "${search}". Try a different search.`
              : "Be the first to upload a full-length video to this category."}
          </p>
          <button
            type="button"
            onClick={startUpload}
            className="mt-4 rounded-full create-pink px-4 py-2 text-sm font-semibold"
          >
            Upload a video
          </button>
        </div>
      ) : (
        /* Two columns on phones, more as the screen grows — like YouTube's grid. */
        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-4">
          {videos.map((v) => (
            <FullVideoCard
              key={v.id}
              video={v}
              onEdit={auth.user && v.user_id === auth.user.id ? setEditing : undefined}
            />
          ))}
        </div>
      )}

      {videos.length > 0 && (
        <div className="mt-8 text-center">
          <Link to="/" className="text-sm text-muted-foreground underline">
            Back to the feed
          </Link>
        </div>
      )}

      {/* Owner-only editor, opened from the pencil on a card. */}
      {editing && auth.user && (
        <EditFullVideoDialog
          video={editing}
          userId={auth.user.id}
          open
          onClose={() => setEditing(null)}
          onSaved={(next) =>
            setVideos((prev) => prev.map((v) => (v.id === next.id ? next : v)))
          }
          onDeleted={(id) => setVideos((prev) => prev.filter((v) => v.id !== id))}
        />
      )}
    </div>
  );
}
