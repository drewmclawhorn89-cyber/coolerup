import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Compass, Heart, Home, Plus, Search, User, Users } from "lucide-react";
import { VideoCard } from "@/components/VideoCard";
import { UploadDialog } from "@/components/UploadDialog";
import { fetchMyLikes, fetchVideos, ME, type Video } from "@/lib/loop";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Loop — For You" },
      { name: "description", content: "A fresh perspective with every scroll. Less perfect, more real." },
      { property: "og:title", content: "Loop — A little more you" },
      { property: "og:description", content: "A fresh perspective with every scroll. Less perfect, more real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Tab = "foryou" | "explore" | "following" | "liked" | "mine";

const NAV: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "foryou", label: "For You", icon: Home },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "following", label: "Following", icon: Users },
  { id: "liked", label: "Liked", icon: Heart },
  { id: "mine", label: "Your videos", icon: User },
];

const HEADERS: Record<Tab, [string, string]> = {
  foryou: ["For You", "A fresh perspective with every scroll"],
  explore: ["Explore", "Most loved right now"],
  following: ["Following", "Creators you keep coming back to"],
  liked: ["Liked", "Everything you've hearted"],
  mine: ["Your videos", "Your point of view, on loop"],
};

function Index() {
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("foryou");
  const [query, setQuery] = useState("");
  const [muted, setMuted] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(false);

  const load = () =>
    fetchVideos()
      .then(setVideos)
      .catch(() => setError(true));

  useEffect(() => {
    load();
    fetchMyLikes().then(setLiked);
  }, []);

  const shown = useMemo(() => {
    let list = videos ?? [];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((v) => v.caption.toLowerCase().includes(q) || v.username.toLowerCase().includes(q));
    if (tab === "explore") list = [...list].sort((a, b) => b.likes_count - a.likes_count);
    if (tab === "following") list = list.filter((v) => v.username !== ME);
    if (tab === "liked") list = list.filter((v) => liked.has(v.id));
    if (tab === "mine") list = list.filter((v) => v.username === ME);
    return list;
  }, [videos, query, tab, liked]);

  const [title, sub] = query ? [`Results for "${query}"`, `${shown.length} videos`] : HEADERS[tab];

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="flex w-72 shrink-0 flex-col gap-6 border-r bg-sidebar p-6">
        <div>
          <h1 className="font-display text-4xl tracking-tight">
            loop<span className="text-primary">.</span>
          </h1>
          <p className="mt-1 text-[11px] font-bold tracking-[0.3em] text-muted-foreground">A LITTLE MORE YOU</p>
        </div>
        <label className="flex items-center gap-2 rounded-full bg-secondary px-4 py-2.5">
          <Search className="h-4 w-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search videos"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </label>
        <nav className="flex flex-col gap-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left font-bold transition ${
                tab === id ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </button>
          ))}
        </nav>
        <button
          onClick={() => setUploading(true)}
          className="flex items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)] transition hover:brightness-110"
        >
          <Plus className="h-5 w-5" /> Upload video
        </button>
        <div className="mt-auto flex items-center gap-3 rounded-xl bg-secondary p-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-display text-primary-foreground">
            D
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Signed in as</p>
            <p className="font-bold">Drew</p>
          </div>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="px-10 pb-2 pt-6">
          <h2 className="font-display text-3xl">{title}</h2>
          <p className="text-sm text-muted-foreground">{sub}</p>
        </header>
        <div className="no-scrollbar flex-1 snap-y snap-mandatory overflow-y-scroll">
          {error && <Empty text="Couldn't load videos. Refresh to try again." />}
          {!error && videos === null && <Empty text="Loading your feed…" />}
          {videos && shown.length === 0 && <Empty text="Nothing here yet." />}
          {shown.map((v) => (
            <VideoCard
              key={`${tab}-${v.id}`}
              video={v}
              liked={liked.has(v.id)}
              muted={muted}
              onToggleMute={() => setMuted((m) => !m)}
              onLikeChange={(on) =>
                setLiked((s) => {
                  const n = new Set(s);
                  if (on) n.add(v.id);
                  else n.delete(v.id);
                  return n;
                })
              }
            />
          ))}
        </div>
      </main>

      <aside className="hidden w-80 shrink-0 flex-col justify-center p-8 xl:flex">
        <div className="rounded-3xl border bg-card p-8">
          <span className="mb-6 block h-3 w-3 rounded-full bg-primary" />
          <p className="font-display text-4xl leading-[0.95]">
            LESS PERFECT.
            <br />
            <span className="text-primary">MORE REAL.</span>
          </p>
          <p className="mt-6 text-muted-foreground">The world wants your point of view</p>
          <button
            onClick={() => setUploading(true)}
            className="mt-8 w-full rounded-full border border-primary py-3 font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
          >
            Share yours
          </button>
        </div>
      </aside>

      {uploading && (
        <UploadDialog
          onClose={() => setUploading(false)}
          onDone={() => {
            setUploading(false);
            setTab("mine");
            load();
          }}
        />
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground">{text}</div>;
}
