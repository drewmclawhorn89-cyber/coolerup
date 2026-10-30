import { createFileRoute, Link } from "@tanstack/react-router";
import { Fragment, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bell,
  Download,
  Heart,
  Home,
  LogOut,
  MessageCircle,
  Plus,
  Search,
  ShoppingBag,
  User,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { VideoCard } from "@/components/VideoCard";
import { matchesKeyword, readBool } from "@/lib/prefs";
// Heavy, interaction-only surfaces are split out so the initial feed bundle stays small.
const UploadDialog = lazy(() => import("@/components/UploadDialog").then((m) => ({ default: m.UploadDialog })));
const ShopPanel = lazy(() => import("@/components/ShopPanel").then((m) => ({ default: m.ShopPanel })));
const SubscriptionsPanel = lazy(() =>
  import("@/components/SubscriptionsPanel").then((m) => ({ default: m.SubscriptionsPanel })),
);
const Marketplace = lazy(() => import("@/components/Marketplace").then((m) => ({ default: m.Marketplace })));
const GroupsPanel = lazy(() => import("@/components/GroupsPanel").then((m) => ({ default: m.GroupsPanel })));
const LiveStreamDialog = lazy(() =>
  import("@/components/LiveStreamDialog").then((m) => ({ default: m.LiveStreamDialog })),
);
const RecordDialog = lazy(() => import("@/components/RecordDialog").then((m) => ({ default: m.RecordDialog })));
const PhotoDialog = lazy(() => import("@/components/PhotoDialog").then((m) => ({ default: m.PhotoDialog })));
import {
  fetchMyLikes,
  fetchRepostsByHandles,
  fetchVideoCounts,
  fetchVideos,
  parseCaption,
  resetFeedOrder,
  type Video,
} from "@/lib/loop";
import { listSaved, onOfflineChange } from "@/lib/offline";
import { readFeedCache, writeFeedCache } from "@/lib/feed-cache";
import { feedPageSize, isLiteMode, useNetwork } from "@/lib/network";
import { useBlocked } from "@/lib/safety";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
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

type Tab = "foryou" | "explore" | "following" | "liked" | "saved" | "inbox" | "shop" | "subscriptions";
type FeedTab = "home" | "following" | "foryou" | "explore" | "marketplace" | "groups" | "live";
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
  { id: "shop", label: "Shop", icon: ShoppingBag },
];

const HEADERS: Record<Tab, [string, string]> = {
  foryou: ["For You", "A fresh perspective with every scroll"],
  explore: ["Explore", "Most loved right now"],
  following: ["Following", "Creators you keep coming back to"],
  liked: ["Liked", "Everything you've hearted"],
  saved: ["Offline", "Watch anytime, even without a connection"],
  inbox: ["Inbox", "All your notifications"],
  shop: ["Shop", "Unlock tops and names"],
  subscriptions: ["Subscriptions", "Paid plans and perks"],
};

function Index() {
  const auth = useAuth();
  const me = auth.handle;
  const net = useNetwork();
  const lite = isLiteMode(net);

  // Ban enforcement now lives in <BanGate /> (mounted in __root.tsx), which
  // covers every route and shows a proper blocked screen instead of an alert.

  const [videos, setVideos] = useState<Video[] | null>(null);
  const [myPostCount, setMyPostCount] = useState(0);
  useEffect(() => {
    if (!me) {
      setMyPostCount(0);
      return;
    }
    supabase
      .from("videos")
      .select("id", { count: "exact", head: true })
      .eq("username", me)
      .then(({ count }) => setMyPostCount(count ?? 0));
  }, [me, videos]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [saved, setSaved] = useState<Video[]>([]);
  const [online, setOnline] = useState(true);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [tab, setTab] = useState<Tab>(() => {
    // Deep link support: /?tab=subscriptions lets upgrade prompts land the
    // user straight on the plans instead of the feed.
    if (typeof window !== "undefined") {
      const wanted = new URLSearchParams(window.location.search).get("tab");
      if (wanted === "subscriptions" || wanted === "shop") return wanted;
    }
    return "foryou";
  });
  const [feedTab, setFeedTab] = useState<FeedTab>(() => {
    // Deep link support: /?feed=groups (and friends) lands on that top tab.
    if (typeof window !== "undefined") {
      const wanted = new URLSearchParams(window.location.search).get("feed");
      if (
        wanted === "home" ||
        wanted === "following" ||
        wanted === "foryou" ||
        wanted === "explore" ||
        wanted === "marketplace" ||
        wanted === "groups" ||
        wanted === "live"
      ) {
        return wanted;
      }
    }
    return "foryou";
  });
  const [followingList, setFollowingList] = useState<string[]>([]);
  const [repostedFeed, setRepostedFeed] = useState<Video[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // Moderation: videos the user tapped "Not interested" on, plus blocked authors.
  const { blocked } = useBlocked();
  const [notInterested, setNotInterested] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem("loop-not-interested") || "[]") as string[]);
    } catch {
      return new Set<string>();
    }
  });
  useEffect(() => {
    const sync = () => {
      try {
        setNotInterested(new Set(JSON.parse(localStorage.getItem("loop-not-interested") || "[]") as string[]));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("loop-not-interested-changed", sync);
    return () => window.removeEventListener("loop-not-interested-changed", sync);
  }, []);

  // Load all saved video ids once instead of one query per card.
  useEffect(() => {
    if (!auth.user) {
      setSavedIds(new Set());
      return;
    }
    let active = true;
    supabase
      .from("saved_videos")
      .select("video_id")
      .eq("user_id", auth.user.id)
      .then(({ data }) => {
        if (active) setSavedIds(new Set((data ?? []).map((r) => r.video_id)));
      });
    return () => {
      active = false;
    };
  }, [auth.user?.id]);

  useEffect(() => {
    if (!auth.user) {
      setFollowingList([]);
      return;
    }
    supabase
      .from("follows")
      .select("following_username")
      .eq("follower_id", auth.user.id)
      .then(({ data }) => setFollowingList((data ?? []).map((r) => r.following_username)));
  }, [auth.user?.id]);

  // Reposts by people you follow show up in the Following feed.
  useEffect(() => {
    if (!auth.user || followingList.length === 0) {
      setRepostedFeed([]);
      return;
    }
    let active = true;
    fetchRepostsByHandles(followingList)
      .then((v) => {
        if (active) setRepostedFeed(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [auth.user?.id, followingList]);
  const [query, setQuery] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadFull, setUploadFull] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  // Keep the create menu mounted after its first open. "Go live" closes the
  // menu before switching to the broadcast view, so unmounting here would
  // throw away the live-stream state and the broadcast screen would never show.
  const [createMenuMounted, setCreateMenuMounted] = useState(false);
  const [error, setError] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [userResults, setUserResults] = useState<
    { id: string; handle: string | null; display_name: string | null; avatar_url: string | null }[]
  >([]);

  useEffect(() => {
    if (createMenuOpen) setCreateMenuMounted(true);
  }, [createMenuOpen]);

  useEffect(() => {
    const q = query.trim().replace(/^@/, "").replace(/[%,()]/g, "");
    if (!q) {
      setUserResults([]);
      return;
    }
    let active = true;
    const t = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, handle, display_name, avatar_url")
        .or(`handle.ilike.%${q}%,display_name.ilike.%${q}%`)
        .limit(8);
      if (active) setUserResults(((data ?? []) as any[]).filter((u) => u.handle));
    }, 250);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [query]);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [notificationFilter, setNotificationFilter] = useState<NotificationFilter>("all");

  // Ref guard (not just state) so two loads can never overlap: a stale
  // `loadingMore` closure used to let the sentinel append a page while the
  // first page was still in flight, which left the previous session's cached
  // order on screen instead of the fresh shuffle.
  const loadingRef = useRef(false);

  const load = useCallback(
    (pageNum = 0, append = false) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoadingMore(true);
      fetchVideos(pageNum, feedPageSize())
        .then((v: any) => {
          if (!v || v.length === 0) setHasMore(false);
          else {
            if (append) setVideos((prev: any) => [...(prev || []), ...v]);
            else {
              setVideos(v);
              writeFeedCache(v);
            }
            setPage(pageNum + 1);
          }
          setError(false);
        })
        .catch(() => setError(true))
        .finally(() => {
          loadingRef.current = false;
          setLoadingMore(false);
        });
    },
    [],
  );

  const loadMore = () => {
    // `page === 0` means the first page has not landed yet — never append
    // before it does or the cached order survives the refresh.
    if (!hasMore || loadingRef.current || page === 0) return;
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
    // Every visit gets a fresh mix: drop the previous shuffle before loading.
    resetFeedOrder();
    // Show the last feed instantly only when the network is slow or we're
    // offline. On a normal connection the cache would put the *same* videos
    // first on every launch, which is exactly what made the feed feel static.
    const cached = !navigator.onLine || lite ? readFeedCache() : null;
    if (cached) {
      const mixed = [...cached];
      for (let i = mixed.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mixed[i], mixed[j]] = [mixed[j]!, mixed[i]!];
      }
      setVideos((cur) => cur ?? mixed);
    }
    load(0, false);

    setTimeout(() => {
      const el = document.querySelector(".no-scrollbar") as HTMLElement | null;
      if (el) el.scrollTop = 0;
    }, 300);

    fetchMyLikes().then(setLiked).catch(() => {});
    const refresh = () =>
      listSaved()
        .then((s) => {
          const vids = s.map((x) => x.video);
          setSaved(vids);
          // Saved rows are snapshots; pull live counters so a video liked or
          // reposted after saving doesn't keep showing 0 in the saved tab.
          if (!navigator.onLine || vids.length === 0) return;
          return fetchVideoCounts(vids.map((v) => v.id))
            .then((counts) =>
              setSaved((prev) =>
                prev.map((v) => {
                  const c = counts.get(v.id);
                  return c ? { ...v, ...c, reposts: c.reposts_count } : v;
                }),
              ),
            )
            .catch(() => {});
        })
        .catch(() => {});
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

  // "Every time you go in the app" — an installed PWA can stay mounted for
  // days, so a mount-only shuffle isn't enough. When the app comes back to the
  // foreground after being away for a while, drop the old order and re-mix the
  // whole library. Short tab hops are ignored so watching isn't interrupted.
  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      if (!hiddenAt || Date.now() - hiddenAt < 60_000) return;
      hiddenAt = 0;
      if (!navigator.onLine) return;
      resetFeedOrder();
      setHasMore(true);
      setPage(0);
      load(0, false);
      const el = document.querySelector(".no-scrollbar") as HTMLElement | null;
      if (el) el.scrollTop = 0;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

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
    if (q) list = list.filter((v) => parseCaption(v.caption).text.toLowerCase().includes(q) || v.username.toLowerCase().includes(q));
    // "Not interested" and blocked authors never come back in this browser.
    if (notInterested.size > 0) list = list.filter((v) => !notInterested.has(v.id));
    if (blocked.size > 0) list = list.filter((v) => !blocked.has(v.username));
    if (activeTab === "explore") list = [...list].sort((a, b) => b.likes_count - a.likes_count);
    if (activeTab === "following") {
      const own = list.filter((v) => followingList.includes(v.username));
      const ids = new Set(own.map((v) => v.id));
      const extras = repostedFeed.filter(
        (v) =>
          !ids.has(v.id) &&
          (!q || parseCaption(v.caption).text.toLowerCase().includes(q) || v.username.toLowerCase().includes(q)),
      );
      list = [...extras, ...own];
    }
    if (activeTab === "foryou" && feedTab === "live") list = list.filter((v) => v.is_live);
    if (activeTab === "liked") list = list.filter((v) => liked.has(v.id));
    if (activeTab !== "saved") {
      list = list.filter((v) => v.username === me || !matchesKeyword(parseCaption(v.caption).text));
      if (readBool("restricted")) list = list.filter((v) => !/\b(nsfw|18\+|gore|explicit)\b/i.test(v.caption ?? ""));
    }
    return list;
  }, [videos, saved, query, activeTab, liked, me, followingList, feedTab, repostedFeed, notInterested, blocked]);

  const showTopTabs = !offlineMode && (activeTab === "foryou" || activeTab === "following" || activeTab === "explore");
  const topTab =
    activeTab === "shop" || activeTab === "subscriptions"
      ? activeTab
      : activeTab === "following" || activeTab === "explore"
        ? activeTab
        : feedTab;
  const pickFeedTab = (t: FeedTab) => {
    setFeedTab(t);
    setTab(t === "following" || t === "explore" ? t : "foryou");
  };

  // One shared top tab bar (Home | Following | For You | Marketplace | Groups | LIVE).
  // Shop stays on the end of the scrollable row so that screen is still
  // reachable on phones. Subscriptions now lives in Settings (/?tab=subscriptions
  // deep links still resolve for upgrade prompts).
  const TopTabs = ({ className = "" }: { className?: string }) => (
    <div className={className}>
      <button onClick={() => pickFeedTab("home")} className={tabClass("home")}>Home</button>
      <button onClick={() => pickFeedTab("following")} className={tabClass("following")}>Following</button>
      <button onClick={() => pickFeedTab("foryou")} className={tabClass("foryou")}>For You</button>
      <button onClick={() => pickFeedTab("marketplace")} className={tabClass("marketplace")}>Marketplace</button>
      <button onClick={() => pickFeedTab("groups")} className={tabClass("groups")}>Groups</button>
      <button onClick={() => pickFeedTab("live")} className={tabClass("live")}>
        <span className="h-2 w-2 rounded-full bg-red-500" />
        LIVE
      </button>
      <button onClick={() => pickFeedTab("explore")} className={tabClass("explore")}>Explore</button>
      <button onClick={() => setTab("shop")} className={tabClass("shop")}>Shop</button>
    </div>
  );
  const topTabsClass =
    "absolute inset-x-0 top-0 z-40 flex justify-center gap-3 overflow-x-auto bg-gradient-to-b from-black/80 to-transparent px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] no-scrollbar [&>button]:shrink-0 [&>button]:whitespace-nowrap";
  const tabClass = (t: string) =>
    `flex items-center gap-1 border-b-2 pb-1 text-[15px] ${topTab === t ? "border-white font-bold text-white" : "border-transparent text-white/60"}`;

  const [title, sub] = query ? [`Results for "${query}"`, `${shown.length} videos`] : HEADERS[activeTab];

  // Stable callbacks so memoized VideoCards don't re-render on every feed update.
  const handleLikeChange = useCallback((videoId: string, on: boolean) => {
    setLiked((s) => {
      const n = new Set(s);
      if (on) n.add(videoId);
      else n.delete(videoId);
      return n;
    });
  }, []);
  const handleToggleMute = useCallback(() => setMuted((m) => !m), []);
  const handleFollowChange = useCallback((username: string, following: boolean) => {
    setFollowingList((list) =>
      following ? (list.includes(username) ? list : [...list, username]) : list.filter((u) => u !== username),
    );
  }, []);
  const handleSavedChange = useCallback((videoId: string, saved: boolean) => {
    setSavedIds((prev) => {
      const n = new Set(prev);
      if (saved) n.add(videoId);
      else n.delete(videoId);
      return n;
    });
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <aside className="hidden w-72 shrink-0 flex-col gap-6 border-r bg-sidebar p-6 md:flex">
        <div>
          <h1 className="font-display text-4xl tracking-tight">
            coolerup<span className="text-primary">.</span>
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
          onClick={() => (auth.user ? setCreateMenuOpen(true) : auth.signIn())}
          className="flex items-center justify-center gap-2 rounded-full bg-primary py-3.5 font-bold text-primary-foreground shadow-[0_10px_30px_-10px_var(--primary)] transition hover:brightness-95"
        >
          <Plus className="h-5 w-5" /> Create
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

      <main className="relative mx-auto flex h-[100dvh] w-full min-w-0 max-w-[430px] flex-1 flex-col bg-black md:h-auto md:max-w-none md:bg-transparent">
        {/* Floating controls: no bar and no logo, just search + profile over the video. */}
        <div className="pointer-events-none absolute inset-x-0 top-[calc(env(safe-area-inset-top)+2.75rem)] z-50 flex items-center justify-end gap-2 px-3 md:hidden">
          <Button
            variant="ghost"
            size="icon"
            aria-label={searchOpen ? "Close search" : "Search videos"}
            onClick={() => setSearchOpen((open) => !open)}
            className="pointer-events-auto rounded-full bg-black/35 text-white backdrop-blur-sm hover:bg-black/55 hover:text-white"
          >
            {searchOpen ? <X /> : <Search />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label={auth.user ? "Sign out" : "Sign in"}
            onClick={auth.user ? auth.signOut : auth.signIn}
            className="pointer-events-auto rounded-full bg-black/35 text-white backdrop-blur-sm hover:bg-black/55 hover:text-white"
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

        {searchOpen && (
          <label className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+5.75rem)] z-50 flex items-center gap-3 rounded-full border border-white/15 bg-black/70 px-4 py-2 backdrop-blur md:hidden">
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

        {!offlineMode && lite && (
          <div className="flex shrink-0 items-center gap-2 bg-secondary px-4 py-1.5 text-xs font-bold text-muted-foreground md:px-10">
            <Wifi className="h-3.5 w-3.5" /> Lite mode — saving data on a slow connection
          </div>
        )}

        {query.trim() && userResults.length > 0 && (
          <div className="shrink-0 border-b bg-sidebar px-4 py-3 md:px-10">
            <p className="mb-2 text-xs font-bold uppercase tracking-widest text-muted-foreground">Users</p>
            <div className="flex flex-col gap-1">
              {userResults.map((u) => (
                <Link
                  key={u.id}
                  to="/u/$username"
                  params={{ username: u.handle! }}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition hover:bg-secondary"
                >
                  <span className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-secondary font-bold uppercase">
                    {u.avatar_url ? (
                      <img src={u.avatar_url} alt={u.display_name || u.handle!} className="h-full w-full object-cover" />
                    ) : (
                      u.handle![0]
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-bold">{u.display_name || u.handle}</span>
                    <span className="block truncate text-sm text-muted-foreground">@{u.handle}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        )}

        {activeTab === "foryou" && feedTab === "marketplace" && !offlineMode ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <TopTabs className={topTabsClass} />
            <Suspense fallback={null}>
              <Marketplace />
            </Suspense>
          </div>
        ) : activeTab === "shop" || activeTab === "subscriptions" ? (
          <div className="flex min-h-0 flex-1 flex-col">
            <TopTabs className="flex shrink-0 justify-center gap-3 overflow-x-auto bg-black px-3 pb-2 pt-[calc(env(safe-area-inset-top)+5.5rem)] no-scrollbar [&>button]:shrink-0 [&>button]:whitespace-nowrap md:hidden" />
            <div className="min-h-0 flex-1 overflow-y-auto">
            {activeTab === "subscriptions" ? (
              <Suspense fallback={null}>
                <SubscriptionsPanel handle={me} onSignIn={auth.signIn} />
              </Suspense>
            ) : (
              <Suspense fallback={null}>
                <ShopPanel handle={me} posts={myPostCount} />
              </Suspense>
            )}
            </div>
          </div>
        ) : activeTab === "foryou" && feedTab === "groups" && !offlineMode ? (
          <div className="relative flex min-h-0 flex-1 flex-col bg-black">
            <TopTabs className={topTabsClass} />
            <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto pt-[calc(env(safe-area-inset-top)+5.5rem)]">
              <Suspense fallback={null}>
                <GroupsPanel />
              </Suspense>
            </div>
          </div>
        ) : activeTab === "inbox" ? (
          <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="sticky top-0 z-10 border-b bg-black/85 px-6 pb-4 pt-[calc(env(safe-area-inset-top)+5.75rem)] backdrop-blur">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-2xl font-display font-bold">Inbox</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {notifications.length === 0
                      ? "All your notifications in one place"
                      : `${notifications.length} notification${notifications.length === 1 ? "" : "s"}${
                          unreadCount > 0 ? ` \u00b7 ${unreadCount} unread` : ""
                        }`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
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
            </div>

            <div className="mx-auto w-full max-w-2xl space-y-3 px-6 pb-28 pt-6">
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
            <header className={`shrink-0 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+5.75rem)] md:px-10 md:pb-2 md:pt-6 ${showTopTabs ? "hidden md:block" : ""}`}>
              <h2 className="break-words font-display text-base md:text-3xl">{title}</h2>
              <p className="hidden text-sm text-muted-foreground md:block">{sub}</p>
            </header>

            <div className="relative flex min-h-0 flex-1 flex-col">
            {showTopTabs && (
              <TopTabs className={`${topTabsClass} md:hidden`} />
            )}
            <div className="no-scrollbar min-h-0 flex-1 snap-y snap-mandatory overflow-y-scroll overscroll-contain scroll-smooth">
              {error && !offlineMode && !(videos && videos.length > 0) && (
                <Empty text="Couldn't load videos. Refresh to try again." />
              )}
              {!error && videos === null && activeTab !== "saved" && <Empty text="Loading your feed..." />}
              {(videos || activeTab === "saved") && shown.length === 0 && (
                <Empty
                  text={
                    activeTab === "saved"
                      ? "No saved videos yet. Tap Share → Save for offline on any video."
                      : activeTab === "foryou" && feedTab === "live"
                        ? "No LIVE now"
                        : activeTab === "following"
                          ? "Follow creators to see their videos here."
                          : "Nothing here yet."
                  }
                />
              )}
              {shown.map((v) => (
                <VideoCard
                  key={`${activeTab}-${v.id}`}
                  video={v}
                  liked={liked.has(v.id)}
                  muted={muted}
                  onToggleMute={handleToggleMute}
                  onLikeChange={handleLikeChange}
                  isFollowing={followingList.includes(v.username)}
                  onFollowChange={handleFollowChange}
                  isSaved={savedIds.has(v.id)}
                  onSavedChange={handleSavedChange}
                />
              ))}
              <div id="scroll-sentinel" className="h-10 w-full" />
            </div>
            </div>
          </>
        )}

        <nav aria-label="Phone navigation" className="mobile-top-nav grid shrink-0 grid-cols-5 place-items-center w-full gap-0 border-0 bg-black px-0 rounded-none md:hidden">
          {NAV.filter((n) => n.id === "foryou" || n.id === "following").map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="ghost"
              onClick={() => {
                setTab(id);
                if (id === "foryou") setFeedTab("foryou");
              }}
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
            aria-label="Create video or go live"
            onClick={() => (auth.user ? setCreateMenuOpen(true) : auth.signIn())}
            className="m-auto h-9 w-10 rounded-lg px-0 [&_svg]:size-6"
          >
            <Plus />
          </Button>
          {NAV.filter((n) => n.id === "inbox").map(({ id, label, icon: Icon }) => (
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
                {label}
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

      {createMenuMounted && (
        <Suspense fallback={null}>
          <LiveStreamDialog
            open={createMenuOpen}
            onOpenChange={setCreateMenuOpen}
            {...(auth.user?.id ? { userId: auth.user.id } : {})}
            username={auth.handle}
            onRecord={() => setRecordingOpen(true)}
            onPhoto={() => setPhotoOpen(true)}
            onUpload={() => {
              setUploadFull(false);
              setUploading(true);
            }}
          />
        </Suspense>
      )}

      {uploading && auth.handle && (
        <Suspense fallback={null}>
          <UploadDialog
            defaultUsername={auth.handle}
            full={uploadFull}
            onClose={() => setUploading(false)}
            onDone={() => {
              setUploading(false);
              setTab("foryou");
              load();
            }}
          />
        </Suspense>
      )}

      {photoOpen && <Suspense fallback={null}><PhotoDialog
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        username={auth.handle}
        onPosted={() => {
          setTab("foryou");
          load();
        }}
      /></Suspense>}

      {recordingOpen && <Suspense fallback={null}><RecordDialog
        open={recordingOpen}
        onOpenChange={setRecordingOpen}
        username={auth.handle}
        onUploadInstead={() => setUploading(true)}
        onPosted={() => {
          setTab("foryou");
          load();
        }}
      /></Suspense>}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="flex h-full items-center justify-center text-muted-foreground">{text}</div>;
}
