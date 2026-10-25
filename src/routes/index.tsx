import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, useEffect, useMemo, useState } from "react";
import {
  Bell,
  Download,
  Heart,
  Home,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  User,
  Users,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoCard } from "@/components/VideoCard";
import { UploadDialog } from "@/components/UploadDialog";
import { RecordDialog } from "@/components/RecordDialog";
import { fetchMyLikes, fetchVideos, type Video } from "@/lib/loop";
import { listSaved, onOfflineChange } from "@/lib/offline";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Coolerup — For You" },
      { name: "description", content: "A fresh perspective with every scroll. Less perfect, more real." },
      { property: "og:title", content: "Coolerup — A little more you" },
      { property: "og:description", content: "A fresh perspective with every scroll. Less perfect, more real." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

type Tab = "foryou" | "explore" | "following" | "liked" | "saved" | "mine" | "inbox";
type NotificationFilter = "all" | "unread";

type NotificationRow = {
  id: string;
  text: string | null;
  type: string | null;
  read: boolean | null;
  created_at: string | null;
  actor_user_id: string | null;
  target_user_id: string | null;
  video_id: string | null;
};

const NAV: { id: Tab; label: string; icon: typeof Home }[] = [
  { id: "foryou", label: "Home", icon: Home },
  { id: "explore", label: "Explore", icon: Users },
  { id: "following", label: "Following", icon: Users },
  { id: "inbox", label: "Inbox", icon: Bell },
  { id: "mine", label: "You", icon: Users },
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

  useEffect(() => {
    if (!me) return;
    supabase
      .from("banned_users")
      .select("*")
      .eq("username", me)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!data) return;
        const isStillBanned = data.is_permanent || (data.expires_at && new Date(data.expires_at) > new Date());
        if (isStillBanned) {
          alert(`You are banned: ${data.reason}`);
          await supabase.auth.signOut();
          window.location.href = "/";
        }
      });
  }, [me]);

  const [videos, setVideos] = useState<Video[] | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saved, setSaved] = useState<Video[]>([]);
  const [online, setOnline] = useState(true);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>("foryou");
  const [query, setQuery] = useState("");
  const [muted, setMuted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [error, setError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [quality, setQuality] = useState<"1080p" | "720p" | "480p">("720p");
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>("all");

  useEffect(() => {
    const conn = (navigator as any).connection;
    if (conn?.effectiveType === "2g" || conn?.effectiveType === "slow-2g") {
      setQuality("480p");
    } else if (conn?.effectiveType === "3g") {
      setQuality("720p");
    } else {
      setQuality("1080p");
    }
  }, []);

  const load = (pageNum = 0, append = false) => {
    if (loadingMore) return;
    setLoadingMore(true);
    fetchVideos(pageNum)
      .then((v: any) => {
        if (!v || v.length === 0) setHasMore(false);
        else {
          if (append) setVideos((prev: any) => [...(prev || []), ...v]);
          else setVideos(v);
          setPage(pageNum + 1);
        }
        setError(false);
      })
      .catch(() => setError(true))
      .finally(() => setLoadingMore(false));
  };

  const loadMore = () => {
    if (!hasMore || loadingMore) return;
    load(page, true);
  };

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) loadMore();
      },
      { threshold: 0.1 }
    );
    const el = document.getElementById("scroll-sentinel");
    if (el) observer.observe(el);
    return () => observer.disconnect();
  }, [page, hasMore, loadingMore]);

  useEffect(() => {
    load(0, false);

    setTimeout(() => {
      const el = document.querySelector(".no-scrollbar") as HTMLElement | null;
      if (el) el.scrollTop = 0;
    }, 300);

    fetchMyLikes().then(setLiked).catch(() => {});
    const refresh = () => listSaved().then((s) => setSaved(s.map((x) => x.video))).catch(() => {});
    refresh();
    const off = onOfflineChange(refresh);
    const update = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine) load(0, false);
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

  useEffect(() => {
    if (!auth.user) return;
    let mounted = true;

    const loadNotifications = async () => {
      const { data } = await supabase
        .from("notifications")
        .select("id, actor_user_id, target_user_id, text, type, video_id, created_at, read")
        .eq("target_user_id", auth.user!.id)
        .order("created_at", { ascending: false });
      if (!mounted) return;
      setNotifications((data ?? []) as NotificationRow[]);
    };

    void loadNotifications();

    const channel = supabase
      .channel(`notifications:user=${auth.user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `target_user_id=eq.${auth.user.id}` },
        (payload) => {
          setNotifications((cur) => [payload.new as NotificationRow, ...cur]);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `target_user_id=eq.${auth.user.id}` },
        (payload) => {
          const updated = payload.new as NotificationRow;
          setNotifications((cur) => cur.map((n) => (n.id === updated.id ? updated : n)));
        }
      )
      .subscribe();

    return () => {
      mounted = false;
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [auth.user?.id]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = async (id: string) => {
    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
    if (error) return;
    setNotifications((n) => n.map((x) => (x.id === id ? { ...x, read: true } : x)));
  };

  const markAllRead = async () => {
    if (!auth.user) return;
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("target_user_id", auth.user.id)
      .eq("read", false);
    if (error) return;
    setNotifications((n) => n.map((x) => ({ ...x, read: true })));
  };

  const filteredNotifications =
    notificationFilter === "unread" ? notifications.filter((n) => !n.read) : notifications;

  const offlineMode = !online || (error && saved.length > 0);
  const activeTab = offlineMode ? "saved" : tab;

  const shown = useMemo(() => {
    let list = activeTab === "saved" ? saved : videos ?? [];
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((v) => v.caption.toLowerCase().includes(q) || v.username.toLowerCase().includes(q));
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
                <span className="flex items-center gap-2">
                  {label}
                  {id === "inbox" && unreadCount > 0 && (
                    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">
                      {unreadCount}
                    </span>
                  )}
                </span>
              </button>
            </Fragment>
          ))}
        </nav>

        <button
          onClick={() => (auth.user ? setUploading(true) : auth.signIn())}
          className="flex items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)] transition hover:brightness-95"
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
            Sign in
          </button>
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="mobile-topbar grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b bg-sidebar px-4 md:hidden">
          <h1 className="min-w-0 font-display text-2xl">
            loop<span className="text-primary">.</span>
          </h1>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              aria-label={searchOpen ? "Close search" : "Search videos"}
              onClick={() => setSearchOpen((open) => !open)}
            >
              {searchOpen ? <X /> : <Search />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={auth.user ? "Sign out" : "Sign in"}
              onClick={auth.user ? auth.signOut : auth.signIn}
            >
              {auth.avatar ? (
                <img src={auth.avatar} alt="" className="h-8 w-8 rounded-full object-cover" />
              ) : auth.user ? (
                <LogOut />
              ) : (
                <User />
              )}
            </Button>
          </div>
        </div>

        {searchOpen && (
          <label className="flex shrink-0 items-center gap-3 border-b bg-sidebar px-4 py-3 md:hidden">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              aria-label="Search videos"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search videos"
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
            />
            {query && (
              <Button variant="ghost" size="icon" aria-label="Clear search" onClick={() => setQuery("")}>
                <X />
              </Button>
            )}
          </label>
        )}

        {offlineMode && (
          <div className="flex shrink-0 items-center gap-2 bg-primary/10 px-4 py-2 text-sm font-bold text-primary md:px-10">
            <WifiOff className="h-4 w-4" /> You're offline — watching saved videos
          </div>
        )}

        {activeTab === "inbox" ? (
          <div className="p-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-2xl font-display font-bold">Inbox</h2>
                <p className="mt-1 text-sm text-muted-foreground">All your notifications in one place</p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant={notificationFilter === "unread" ? "default" : "outline"}
                  size="sm"
                  onClick={() => setNotificationFilter((f) => (f === "all" ? "unread" : "all"))}
                >
                  {notificationFilter === "all" ? "Unread only" : "Show all"}
                </Button>
                {unreadCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={markAllRead}>
                    Mark all read
                  </Button>
                )}
                <Link to="/messages" className="flex items-center gap-3 rounded-xl px-4 py-3 font-bold transition hover:bg-secondary">
                  <MessageCircle className="h-5 w-5" />
                  Messages
                </Link>
              </div>
            </div>

            <div className="mt-6 max-w-2xl space-y-3">
              {filteredNotifications.length === 0 ? (
                <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
                  {notificationFilter === "unread" ? "No unread notifications" : "No notifications"}
                </div>
              ) : (
                filteredNotifications.map((n) => (
                  <div
                    key={n.id}
                    className={`flex items-center gap-3 rounded-xl border bg-card p-4 ${n.read ? "opacity-70" : ""}`}
                    onClick={() => !n.read && markRead(n.id)}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-zinc-500/10 text-lg">
                      {n.type === "like" ? "❤️" : n.type === "follow" ? "👤" : "💬"}
                    </div>
                    <div className="flex-1">
                      <p className="text-sm">{n.text}</p>
                      <p className="text-xs text-muted-foreground">
                        {n.created_at ? new Date(n.created_at).toLocaleString() : ""}
                      </p>
                    </div>
                    {!n.read && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <>
            <header className="shrink-0 px-4 py-2 md:px-10 md:pb-2 md:pt-6">
              <h2 className="break-words font-display text-base md:text-3xl">{title}</h2>
              <p className="hidden text-sm text-muted-foreground md:block">{sub}</p>
            </header>

            <div className="no-scrollbar min-h-0 flex-1 snap-y snap-mandatory overflow-y-scroll overscroll-contain">
              {error && !offlineMode && <Empty text="Couldn't load videos. Refresh to try again." />}
              {!error && videos === null && activeTab !== "saved" && <Empty text="Loading your feed..." />}
              {(videos || activeTab === "saved") && shown.length === 0 && (
                <Empty
                  text={
                    activeTab === "saved"
                      ? "No saved videos yet. Tap Share → Save for offline on any video."
                      : "Nothing here yet."
                  }
                />
              )}
              {shown.map((v) => (
                <VideoCard
                  key={`${activeTab}-${v.id}`}
                  video={v}
                  liked={liked.has(v.id)}
                
                  
                  onLikeChange={(on) => {
                    setLiked((s) => {
                      const n = new Set(s);
                      if (on) n.add(v.id);
                      else n.delete(v.id);
                      return n;
                    });
                  }}
                />
              ))}
              <div id="scroll-sentinel" className="h-10 w-full" />
            </div>
          </>
        )}

        <nav aria-label="Phone navigation" className="mobile-bottom-nav grid shrink-0 grid-cols-7 place-items-center w-full gap-0 border-0 bg-black px-0 rounded-none md:hidden">
          {NAV.slice(0, 3).map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              onClick={() => setTab(id)}
              aria-current={activeTab === id ? "page" : undefined}
              className={`h-14 min-w-0 flex-col gap-1 rounded-none px-0 text-[9px] ${
                activeTab === id ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              {label}
            </Button>
          ))}
          <Button
            aria-label="Record video"
            onClick={() => (auth.user ? setRecordingOpen(true) : auth.signIn())}
            className="m-auto h-9 w-10 rounded-lg px-0 [&_svg]:size-6"
          >
            <Plus />
          </Button>
          {NAV.slice(3).map(({ id, label, icon: Icon }) => (
            <Fragment key={id}>
              <Button
                variant="ghost"
                onClick={() => setTab(id)}
                aria-current={activeTab === id ? "page" : undefined}
                className={`h-14 min-w-0 flex-col gap-1 rounded-none px-0 text-[9px] ${
                  activeTab === id ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <Icon className="h-5 w-5" />
                {id === "mine" ? "You" : label}
              </Button>
            </Fragment>
          ))}
          {auth.user && auth.handle ? (
            <Link
              to="/u/$username"
              params={{ username: auth.handle }}
              aria-label="Profile"
              className="flex h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-none px-0 text-[9px] text-muted-foreground [&_svg]:size-5"
            >
              <User />
              Profile
            </Link>
          ) : (
            <Button
              variant="ghost"
              aria-label="Profile"
              onClick={() => auth.signIn()}
              className="h-14 min-w-0 flex-col gap-1 rounded-none px-0 text-[9px] text-muted-foreground [&_svg]:size-5"
            >
              <User />
              Profile
            </Button>
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
            onClick={() => (auth.user ? setRecordingOpen(true) : auth.signIn())}
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

      <RecordDialog
        open={recordingOpen}
        onOpenChange={setRecordingOpen}
        username={auth.handle}
        onUploadInstead={() => setUploading(true)}
        onPosted={() => {
          setTab("mine");
          load();
        }}
      />
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground">{text}</div>;
}
