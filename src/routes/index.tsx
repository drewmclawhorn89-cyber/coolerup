import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Bell, Compass, Download, Heart, Home, LogOut, MessageCircle, Plus, Search, User, Users, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoCard } from "@/components/VideoCard";
import { UploadDialog } from "@/components/UploadDialog";
import { fetchMyLikes, fetchVideos, type Video } from "@/lib/loop";
import { listSaved, onOfflineChange } from "@/lib/offline";
import { useAuth } from "@/hooks/useAuth";

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


type Tab = "foryou" | "explore" | "following" | "liked" | "saved" | "mine" | "inbox";
const NAV: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "foryou", label: "For You", icon: Home },
  { id: "explore", label: "Explore", icon: Compass },
  { id: "following", label: "Following", icon: Users },
  { id: "liked", label: "Liked", icon: Heart },
  { id: "saved", label: "Offline", icon: Download },
  { id: "mine", label: "Profile", icon: User },
  { id: "inbox", label: "Inbox", icon: Bell },
];


const HEADERS: Record<Tab, [string, string]> = {
  foryou: ["For You", "A fresh perspective with every scroll"],
  explore: ["Explore", "Most loved right now"],
  following: ["Following", "Creators you keep coming back to"],
  liked: ["Liked", "Everything you've hearted"],
  saved: ["Offline", "Watch anytime, even without a connection"],
  mine: ["Profile", "Your loop"],
  inbox: ["Inbox", "All your notifications"],
};

function Index() {
  const auth = useAuth();
  const me = auth.handle;
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [saved, setSaved] = useState<Video[]>([]);
  const [online, setOnline] = useState(true);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("foryou");
  const [query, setQuery] = useState("");
  const [muted, setMuted] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  const load = () => 
    fetchVideos()
      .then((v) => {
        const shuffled = [...v].sort(() => Math.random() - 0.5);
        setVideos(shuffled);
        setError(false);
      })
      .catch(() => setError(true));

  useEffect(() => {
    load();
    fetchMyLikes().then(setLiked).catch(() => {});
    const refresh = () => listSaved().then((s) => setSaved(s.map((x) => x.video))).catch(() => {});
    refresh();
    const off = onOfflineChange(refresh);
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) load();
    };
    setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      off();
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const offlineMode = !online || (error && saved.length > 0);
  const activeTab: Tab = offlineMode ? "saved" : tab;
if (activeTab === "inbox") {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 flex-col gap-6 border-r bg-sidebar p-6 md:flex">
        <div>
          <h1 className="font-display text-4xl tracking-tight">
            loop<span className="text-primary">.</span>
          </h1>
        </div>
      </aside>
      <main className="flex-1 overflow-auto pt-16 md:pt-0">
        <NotificationsInbox />
      </main>
    </div>
  );
}

const shown = useMemo(() => {
  let list = activeTab === "saved" ? saved : (videos ?? []);
  const q = query.trim().toLowerCase();
  if (q) list = list.filter((v) => v.caption.toLowerCase().includes(q) || v.username.toLowerCase().includes(q))
  if (activeTab === "explore") list = [...list].sort((a, b) => b.likes_count - a.likes_count);
  if (activeTab === "following") list = list.filter((v) => v.username !== me);
  if (activeTab === "liked") list = list.filter((v) => liked.has(v.id));
  if (activeTab === "mine") list = me ? list.filter((v) => v.username === me) : [];
  return list;
}, [videos, saved, query, activeTab, liked, me]);
  
  const [title, sub] = query ? [`Results for "${query}"`, `${shown.length} videos`] : HEADERS[activeTab];

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 flex-col gap-6 border-r bg-sidebar p-6 md:flex">
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
            <Fragment key={id}>
              <button
                onClick={() => setTab(id)}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left font-bold transition ${
                  activeTab === id ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary"
                }`}
              >
                <Icon className="h-5 w-5" />
                {label}
              </button>
              {id === "liked" && (
                <Link
                  to="/messages"
                  className="flex items-center gap-3 rounded-xl px-4 py-3 font-bold transition hover:bg-secondary"
                >
                  <MessageCircle className="h-5 w-5" />
                  Messages
                </Link>
              )}
            </Fragment>
          ))}
        </nav>
        <button
          onClick={() => (auth.user ? setUploading(true) : auth.signIn())}
          className="flex items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)] transition hover:brightness-110"
        >
          <Plus className="h-5 w-5" /> Upload video
        </button>
        {auth.ready && auth.user ? (
          <div className="mt-auto flex items-center gap-3 rounded-xl bg-secondary p-3">
            {auth.avatar ? (
              <img src={auth.avatar} alt="" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary font-display uppercase text-primary-foreground">
                {auth.name?.[0]}
              </div>
            )}
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-muted-foreground">Signed in as</p>
              <p className="truncate font-bold">{auth.name}</p>
            </div>
            <button onClick={auth.signOut} aria-label="Sign out" className="text-muted-foreground hover:text-foreground">
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={auth.signIn}
            className="mt-auto flex items-center justify-center gap-2 rounded-xl border bg-secondary p-3 font-bold transition hover:bg-accent"
          >
            Sign in with Google
          </button>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mobile-topbar grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-sidebar px-4 md:hidden">
          <h1 className="min-w-0 font-display text-2xl">loop<span className="text-primary">.</span></h1>
          <div className="flex shrink-0 items-center gap-2">
            <Button variant="ghost" size="icon" aria-label={searchOpen ? "Close search" : "Search videos"} onClick={() => setSearchOpen((open) => !open)}>
              {searchOpen ? <X /> : <Search />}
            </Button>
            <Button variant="ghost" size="icon" aria-label={auth.user ? "Sign out" : "Sign in with Google"} onClick={auth.user ? auth.signOut : auth.signIn}>
              {auth.avatar ? <img src={auth.avatar} alt="" className="h-8 w-8 rounded-full object-cover" /> : auth.user ? <LogOut /> : <User />}
            </Button>
          </div>
        </div>
        {searchOpen && (
          <label className="flex shrink-0 items-center gap-3 border-b bg-sidebar px-4 py-3 md:hidden">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input autoFocus aria-label="Search videos" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search videos" className="min-w-0 flex-1 bg-transparent text-base outline-none" />
            {query && <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => setQuery("")}><X /></Button>}
          </label>
        )}
        {offlineMode && (
          <div className="flex shrink-0 items-center gap-2 bg-primary/10 px-4 py-2 text-sm font-bold text-primary md:px-10">
            <WifiOff className="h-4 w-4" /> You're offline — watching saved videos
          </div>
        )}
      {activeTab === "inbox" ? (
  <div className="p-6">
    <h2 className="text-2xl font-display font-bold">Inbox</h2>
    <p className="text-sm text-muted-foreground mt-1 mb-6">All your notifications in one place</p>
    <div className="space-y-3 max-w-2xl">
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-card">
        <div className="w-10 h-10 rounded-full bg-pink-500/20 flex items-center justify-center">❤️</div>
        <div className="flex-1"><p className="text-sm"><b>@alexfit</b> liked your fit</p><p className="text-xs text-muted-foreground">2m ago</p></div>
        <div className="w-2 h-2 bg-primary rounded-full"></div>
      </div>
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-card">
        <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">👤</div>
        <div className="flex-1"><p className="text-sm"><b>@jordan</b> followed you</p><p className="text-xs text-muted-foreground">1h ago</p></div>
        <div className="w-2 h-2 bg-primary rounded-full"></div>
      </div>
      <div className="flex items-center gap-3 p-4 rounded-xl border bg-card">
        <div className="w-10 h-10 rounded-full bg-zinc-500/20 flex items-center justify-center">💬</div>
        <div className="flex-1"><p className="text-sm"><b>@sam</b> commented: "fire fit 🔥"</p><p className="text-xs text-muted-foreground">3h ago</p></div>
      </div>
    </div>
  </div>
) : (
  <>
    <header className="shrink-0 px-4 py-2 md:px-10 md:pb-2 md:pt-6">
      <h2 className="break-words font-display text-base md:text-3xl">{title}</h2>
      <p className="hidden text-sm text-muted-foreground md:block">{sub}</p>
    </header>  
          
          
        
        <div className="no-scrollbar min-h-0 flex-1 snap-y snap-mandatory overflow-y-scroll overscroll-y-contain">
          {error && !offlineMode && <Empty text="Couldn't load videos. Refresh to try again." />}
          {!error && videos === null && activeTab !== "saved" && <Empty text="Loading your feed…" />}
          {(videos || activeTab === "saved") && shown.length === 0 && (
            <Empty text={activeTab === "saved" ? "No saved videos yet. Tap Share → Save for offline on any video." : "Nothing here yet."} />
          )}
          {shown.map((v) => (
            <VideoCard
              key={`${activeTab}-${v.id}`}
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
      </>
)}
        <nav aria-label="Phone navigation" className="mobile-bottom-nav grid shrink-0 grid-cols-8 border-t bg-sidebar px-1 md:hidden">
          {NAV.slice(0, 3).map(({ id, label, icon: Icon }) => (
            <Button key={id} variant="ghost" onClick={() => setTab(id)} aria-current={activeTab === id ? "page" : undefined} className={`h-14 min-w-0 flex-col gap-1 rounded-none px-0 text-[9px] [&_svg]:size-5 ${activeTab === id ? "text-primary" : "text-muted-foreground"}`}><Icon />{label}</Button>
          ))}
          <Button aria-label="Upload video" onClick={() => (auth.user ? setUploading(true) : auth.signIn())} className="m-auto h-9 w-10 rounded-lg px-0 [&_svg]:size-6"><Plus /></Button>
          {NAV.slice(3).map(({ id, label, icon: Icon }) => (
            <Fragment key={id}>
              <Button variant="ghost" onClick={() => setTab(id)} aria-current={activeTab === id ? "page" : undefined} className={`h-14 min-w-0 flex-col gap-1 rounded-none px-0 text-[9px] [&_svg]:size-5 ${activeTab === id ? "text-primary" : "text-muted-foreground"}`}><Icon />{id === "mine" ? "You" : label}</Button>
              {id === "liked" && (
                <Link to="/messages" aria-label="Messages" className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-none px-0 text-[9px] text-muted-foreground [&_svg]:size-5"><MessageCircle />Messages</Link>
              )}
            </Fragment>
          ))}
          {auth.user && auth.handle ? (
            <Link to="/u/$username" params={{ username: auth.handle }} aria-label="Profile" className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-none px-0 text-[9px] text-muted-foreground [&_svg]:size-5"><User />Profile</Link>
          ) : (
            <Button variant="ghost" aria-label="Profile" onClick={() => auth.signIn()} className="h-14 min-w-0 flex-col gap-1 rounded-none px-0 text-[9px] text-muted-foreground [&_svg]:size-5"><User />Profile</Button>
          )}
        </nav>
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
            onClick={() => (auth.user ? setUploading(true) : auth.signIn())}
            className="mt-8 w-full rounded-full border border-primary py-3 font-bold text-primary transition hover:bg-primary hover:text-primary-foreground"
          >
            Share yours
          </button>
        </div>
      </aside>


      {uploading && auth.handle && (
        <UploadDialog
          defaultUsername={auth.handle}
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
