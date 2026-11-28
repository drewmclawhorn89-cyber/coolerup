import { findItem, useEquipped } from "@/lib/shop";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft,
  Bookmark,
  Eye,
  EyeOff,
  Grid3x3,
  Heart,
  Lock,
  Pencil,
  Plus,
  Repeat2,
  UserRoundPlus,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { BANNED_TEXT, useIsBanned } from "@/lib/safety";
import {
  EditProfileDialog,
  LINK_FIELDS,
  normalizeLink,
  resolveAvatarUrl,
} from "@/components/EditProfileDialog";
import { fetchMyLikes, isImageUrl, parseCaption, resolveVideoUrl, type Video } from "@/lib/loop";
import {
  EMPTY_PROFILE_COUNTS,
  PROFILE_PAGE_SIZE,
  fetchLikedVideosPage,
  fetchProfileCounts,
  fetchProfileVideosPage,
  fetchRepostedVideosPage,
  fetchSavedVideosPage,
  type ProfileCounts,
} from "@/lib/profile";
import { ProfileStats } from "@/components/ProfileStats";
import { TikTokProfileCard } from "@/components/TikTokProfileCard";
import { VideoCard } from "@/components/VideoCard";
import { StoryViewer } from "@/components/StoryViewer";
import { fetchStories, postStory, type Story } from "@/lib/stories";
import { useChristmasMode } from "@/lib/christmas";
import { toast } from "sonner";
import { followUser, isFollowing as checkIsFollowing, unfollowUser } from "@/lib/follow";
import type { Profile as ProfileRow } from "@/hooks/useAuth";
import { OnlineDot, OnlineStatusSubtitle } from "@/components/OnlineStatusBadge";
import { normalizePresenceHandle, useOnlineStatus, useOnlineStatuses } from "@/lib/onlineStatus";
import { ReportButton } from "@/components/ReportButton";
import { PaidVideoGate } from "@/components/PaidVideoGate";
import { PAID_GOLD } from "@/components/PaidVideoFields";
import {
  formatPriceCents,
  useMyPaidVideos,
  usePurchasedVideos,
  useVideoOwnership,
  type PaidVideoKind,
} from "@/lib/paidVideos";
import { useCompressedThumbnail } from "@/lib/thumbnailCache";
import { isLiteMode, useNetwork } from "@/lib/network";
import { preloadModeFor } from "@/lib/feedPaging";
import { planById, useSubscription } from "@/lib/subscriptions";
import { FeedLoadingSpinner } from "@/components/FeedLoadingSpinner";
import { ListRowSkeleton, VideoGridSkeleton } from "@/components/Skeletons";

const FOLLOW_PAGE_SIZE = 10;

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function Thumb({ url, caption }: { url: string; caption: string }) {
  const [src, setSrc] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const isImage = isImageUrl(url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(url);
  const compressed = useCompressedThumbnail(isImage && src ? src : null, { maxDim: 240 });

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return;
    }
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          setNear(true);
          obs.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let alive = true;
    resolveVideoUrl(url).then((u) => {
      if (alive) setSrc(u);
    });
    return () => {
      alive = false;
    };
  }, [url, near]);
  if (!src) return <div ref={boxRef} className="h-full w-full bg-zinc-900" />;
  return isImage ? (
    <img
      src={compressed ?? src}
      alt={caption}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
  ) : (
    <video
      src={`${src}#t=0.5`}
      muted
      playsInline
      preload="metadata"
      className="h-full w-full object-cover"
    />
  );
}

function FollowAvatarImg({ avatar, alt }: { avatar: string; alt: string }) {
  const compressed = useCompressedThumbnail(avatar, { maxDim: 120 });
  return (
    <img
      src={compressed ?? avatar}
      alt={alt}
      loading="lazy"
      decoding="async"
      className="h-full w-full object-cover"
    />
  );
}

type FollowingUser = {
  handle: string;
  display_name: string | null;
  avatar: string | null;
};

type TabKey = "videos" | "reposts" | "liked" | "saved";

/** Profile tabs, TikTok order: videos · reposts · liked · saved. */
const TABS = [
  { key: "videos", label: "Videos", icon: Grid3x3 },
  { key: "reposts", label: "Reposts", icon: Repeat2 },
  { key: "liked", label: "Liked videos", icon: Heart },
  { key: "saved", label: "Saved videos", icon: Bookmark },
] as const;

/* -------------------------------------------------------------------------- */
/*  Paid video shelves                                                        */
/* -------------------------------------------------------------------------- */

/** One card on either shelf, normalised from the two different row shapes. */
type ShelfItem = {
  id: string;
  kind: PaidVideoKind;
  title: string;
  thumbnailUrl: string | null;
  videoUrl: string;
  priceCents: number;
  subtitle?: string | undefined;
};

/**
 * A single shelf card. Long form opens the real watch page; short form opens a
 * small in-page player, because short videos have no page of their own.
 */
function PaidShelfCard({ item, onOpen }: { item: ShelfItem; onOpen: (item: ShelfItem) => void }) {
  const owned = useVideoOwnership(item.id, item.kind, true);
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    resolveVideoUrl(item.videoUrl)
      .then((u) => {
        if (alive) setSrc(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.videoUrl]);

  const inner = (
    <>
      <div className="absolute inset-0 bg-secondary">
        {src ? (
          <video
            src={src}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        ) : null}
      </div>
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent px-1.5 pb-1.5 pt-6">
        <p className="line-clamp-2 text-[11px] font-semibold leading-tight text-white">
          {item.title || "Paid video"}
        </p>
        {item.subtitle && (
          <p className="mt-0.5 truncate text-[10px] text-white/60">{item.subtitle}</p>
        )}
      </div>
      <span
        className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-bold leading-none"
        style={{ backgroundColor: "rgba(0,0,0,0.78)", color: PAID_GOLD }}
      >
        <span aria-hidden>{owned ? "✓" : "🔒"}</span>
        {owned ? "Unlocked" : formatPriceCents(item.priceCents)}
      </span>
    </>
  );

  if (item.kind === "full") {
    return (
      <Link
        to="/watch/$id"
        params={{ id: item.id }}
        className="group relative aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-lg bg-secondary"
        aria-label={`Open ${item.title || "paid video"}`}
      >
        {inner}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="group relative aspect-[3/4] w-32 shrink-0 overflow-hidden rounded-lg bg-secondary"
      aria-label={`Play ${item.title || "paid video"}`}
    >
      {inner}
    </button>
  );
}

/** A titled horizontal shelf with an honest empty state. */
function PaidShelf({
  title,
  hint,
  empty,
  items,
  loading,
  onOpen,
}: {
  title: string;
  hint?: string;
  empty: string;
  items: ShelfItem[];
  loading: boolean;
  onOpen: (item: ShelfItem) => void;
}) {
  return (
    <section className="rounded-2xl border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold">
          <span aria-hidden style={{ color: PAID_GOLD }}>
            🔒
          </span>
          {title}
        </h2>
        {items.length > 0 && (
          <span className="text-xs tabular-nums text-muted-foreground">{items.length}</span>
        )}
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
      {loading ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading…</p>
      ) : items.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">{empty}</p>
      ) : (
        <div className="mt-2.5 flex gap-2 overflow-x-auto pb-1">
          {items.map((item) => (
            <PaidShelfCard key={`${item.kind}:${item.id}`} item={item} onOpen={onOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

function Profile() {
  const { username } = Route.useParams();
  // A banned account keeps no public profile: no grid, no counts, no videos.
  const banned = useIsBanned(username);
  const auth = useAuth();
  // Red/green ring instead of the usual pink gradient, Nov 15 2026 -> Jan 1 2027.
  const christmas = useChristmasMode();
  const net = useNetwork();
  const lite = isLiteMode(net);
  const [counts, setCounts] = useState<ProfileCounts | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [viewerActiveIndex, setViewerActiveIndex] = useState(0);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState<TabKey>("videos");
  const [saved, setSaved] = useState<Video[]>([]);
  const [reposts, setReposts] = useState<Video[]>([]);
  const [likedVideos, setLikedVideos] = useState<Video[] | null>(null);
  const [likedLoading, setLikedLoading] = useState(false);
  /** Whether another page exists per tab (drives infinite scroll). */
  const [hasMore, setHasMore] = useState<Record<TabKey, boolean>>({
    videos: true,
    reposts: true,
    liked: true,
    saved: true,
  });
  const [loadingMore, setLoadingMore] = useState(false);
  /** Bumped after the viewer closes so a tab can refresh its first page. */
  const [reloadKey, setReloadKey] = useState(0);
  const viewer = useRef<HTMLDivElement>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyUploading, setStoryUploading] = useState(false);
  const storyFile = useRef<HTMLInputElement>(null);
  const [following, setFollowing] = useState(false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [followingUsers, setFollowingUsers] = useState<FollowingUser[] | null>(null);
  const [followingHasMore, setFollowingHasMore] = useState(false);
  const [followingLoadingMore, setFollowingLoadingMore] = useState(false);
  const followingOffsetRef = useRef(0);
  const followingLoadingRef = useRef(false);
  const followingScrollRef = useRef<HTMLDivElement | null>(null);
  const followingSentinelRef = useRef<HTMLDivElement | null>(null);
  const [followersOpen, setFollowersOpen] = useState(false);
  const [followersUsers, setFollowersUsers] = useState<FollowingUser[] | null>(null);
  const [followersHasMore, setFollowersHasMore] = useState(false);
  const [followersLoadingMore, setFollowersLoadingMore] = useState(false);
  const followersOffsetRef = useRef(0);
  const followersLoadingRef = useRef(false);
  const followersScrollRef = useRef<HTMLDivElement | null>(null);
  const followersSentinelRef = useRef<HTMLDivElement | null>(null);

  const equipped = useEquipped(username);
  const isOwn = !!auth.handle && auth.handle === username;
  // The owner's plan is read from the account, so it follows them to a new
  // phone. Other viewers see nothing here.
  const mySubscription = useSubscription(isOwn ? auth.handle : null);
  /** Paid shelves are private: they only ever load for your own profile. */
  const myPaid = useMyPaidVideos(isOwn ? (profile?.id ?? null) : null);
  const purchased = usePurchasedVideos(isOwn ? (auth.user?.id ?? null) : null);
  const [paidPreview, setPaidPreview] = useState<ShelfItem | null>(null);
  const [paidPreviewSrc, setPaidPreviewSrc] = useState("");
  useEffect(() => {
    if (!paidPreview) {
      setPaidPreviewSrc("");
      return;
    }
    let alive = true;
    resolveVideoUrl(paidPreview.videoUrl)
      .then((u) => {
        if (alive) setPaidPreviewSrc(u);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [paidPreview]);
  const showLiked = profile?.show_liked !== false;
  const canSeeLiked = showLiked || isOwn;
  const profilePresence = useOnlineStatus(username);
  const dialogHandles = useMemo(
    () => [
      ...(followingUsers ?? []).map((u) => u.handle),
      ...(followersUsers ?? []).map((u) => u.handle),
    ],
    [followingUsers, followersUsers],
  );
  const dialogPresence = useOnlineStatuses(dialogHandles);

  useEffect(() => {
    if (!username || !auth.user || isOwn) {
      setFollowing(false);
      return;
    }
    let active = true;
    void checkIsFollowing(auth.user.id, username).then((value) => {
      if (active) setFollowing(value);
    });
    return () => {
      active = false;
    };
  }, [username, auth.user?.id, isOwn]);

  async function toggleProfileFollow() {
    if (followBusy || isOwn || !username) return;
    if (!auth.user) {
      await auth.signIn();
      return;
    }
    if (!auth.handle) {
      toast.error("Complete your profile before following accounts");
      return;
    }
    const next = !following;
    setFollowBusy(true);
    setFollowing(next);
    const result = next
      ? await followUser({
          followerId: auth.user.id,
          followerUsername: auth.handle,
          followingUsername: username,
        })
      : await unfollowUser({ followerId: auth.user.id, followingUsername: username });
    if (!result.ok) {
      setFollowing(!next);
      toast.error(result.error || "Couldn't update follow");
    }
    setFollowBusy(false);
  }

  const hydrateFollowProfiles = useCallback(async (handles: string[]): Promise<FollowingUser[]> => {
    const unique = Array.from(new Set(handles.filter(Boolean)));
    if (unique.length === 0) return [];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("handle, display_name, avatar_url")
      .in("handle", unique);
    const byHandle = new Map((profiles ?? []).map((p) => [p.handle, p]));
    return Promise.all(
      unique.map(async (handle) => {
        const p = byHandle.get(handle);
        return {
          handle,
          display_name: p?.display_name ?? null,
          avatar: await resolveAvatarUrl(p?.avatar_url),
        } as FollowingUser;
      }),
    );
  }, []);

  const loadFollowingPage = useCallback(
    async (append: boolean) => {
      if (!username || followingLoadingRef.current) return;
      if (append && !followingHasMore) return;
      followingLoadingRef.current = true;
      if (append) setFollowingLoadingMore(true);
      try {
        const offset = append ? followingOffsetRef.current : 0;
        const { data: rows } = await supabase
          .from("follows")
          .select("following_username")
          .eq("follower_username", username)
          .order("created_at", { ascending: false })
          .range(offset, offset + FOLLOW_PAGE_SIZE - 1);
        const rawHandles = (rows ?? []).map((r) => r.following_username).filter(Boolean);
        followingOffsetRef.current = offset + rawHandles.length;
        setFollowingHasMore(rawHandles.length === FOLLOW_PAGE_SIZE);
        const list = await hydrateFollowProfiles(rawHandles);
        setFollowingUsers((prev) => {
          if (!append) return list;
          const cur = prev ?? [];
          const seen = new Set(cur.map((u) => u.handle));
          return [...cur, ...list.filter((u) => !seen.has(u.handle))];
        });
      } finally {
        followingLoadingRef.current = false;
        setFollowingLoadingMore(false);
      }
    },
    [username, followingHasMore, hydrateFollowProfiles],
  );

  useEffect(() => {
    if (!followingOpen || !username) return;
    followingOffsetRef.current = 0;
    setFollowingHasMore(false);
    setFollowingUsers(null);
    void loadFollowingPage(false);
  }, [followingOpen, username]);

  useEffect(() => {
    const root = followingScrollRef.current;
    const sentinel = followingSentinelRef.current;
    if (
      !followingOpen ||
      !root ||
      !sentinel ||
      !followingHasMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadFollowingPage(true);
      },
      { root, rootMargin: "100px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [followingOpen, followingHasMore, followingUsers?.length, loadFollowingPage]);

  const loadFollowersPage = useCallback(
    async (append: boolean) => {
      if (!username || followersLoadingRef.current) return;
      if (append && !followersHasMore) return;
      followersLoadingRef.current = true;
      if (append) setFollowersLoadingMore(true);
      try {
        const offset = append ? followersOffsetRef.current : 0;
        const { data: rows } = await supabase
          .from("follows")
          .select("follower_username")
          .eq("following_username", username)
          .order("created_at", { ascending: false })
          .range(offset, offset + FOLLOW_PAGE_SIZE - 1);
        const rawHandles = (rows ?? []).map((r) => r.follower_username).filter(Boolean);
        followersOffsetRef.current = offset + rawHandles.length;
        setFollowersHasMore(rawHandles.length === FOLLOW_PAGE_SIZE);
        const list = await hydrateFollowProfiles(rawHandles);
        setFollowersUsers((prev) => {
          if (!append) return list;
          const cur = prev ?? [];
          const seen = new Set(cur.map((u) => u.handle));
          return [...cur, ...list.filter((u) => !seen.has(u.handle))];
        });
      } finally {
        followersLoadingRef.current = false;
        setFollowersLoadingMore(false);
      }
    },
    [username, followersHasMore, hydrateFollowProfiles],
  );

  useEffect(() => {
    if (!followersOpen || !username) return;
    followersOffsetRef.current = 0;
    setFollowersHasMore(false);
    setFollowersUsers(null);
    void loadFollowersPage(false);
  }, [followersOpen, username]);

  useEffect(() => {
    const root = followersScrollRef.current;
    const sentinel = followersSentinelRef.current;
    if (
      !followersOpen ||
      !root ||
      !sentinel ||
      !followersHasMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadFollowersPage(true);
      },
      { root, rootMargin: "100px" },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [followersOpen, followersHasMore, followersUsers?.length, loadFollowersPage]);

  useEffect(() => {
    if (!username) return;
    let alive = true;
    void (async () => {
      try {
        const { data } = await supabase
          .from("profiles")
          .select(
            "id, handle, username, display_name, bio, avatar_url, links, created_at, onboarding_complete, show_liked, is_admin",
          )
          .eq("handle", username)
          .maybeSingle();
        if (!alive) return;
        const row = (data as ProfileRow | null) ?? null;
        setProfile(row);
        try {
          const url = await resolveAvatarUrl(row?.avatar_url);
          if (alive) setAvatar(url);
        } catch {
          if (alive) setAvatar(null);
        }
      } catch {
        if (!alive) return;
        setProfile(null);
        setAvatar(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [username, auth.profile?.avatar_url, auth.profile?.display_name, auth.profile?.bio]);

  // Exact totals for every profile number. `count: "exact"` ignores the 1000
  // row response cap that used to freeze counts at "1000".
  useEffect(() => {
    if (!username) return;
    let alive = true;
    setCounts(null);
    fetchProfileCounts(profile?.id ?? "", username)
      .then((next) => {
        if (!alive) return;
        setCounts(next);
      })
      .catch(() => {
        if (alive) setCounts(EMPTY_PROFILE_COUNTS);
      });
    return () => {
      alive = false;
    };
  }, [username, profile?.id, reloadKey]);

  // Re-read the exact counts when the tab regains focus, so a device that was
  // showing a stale cached number (the old "1000" cap) snaps to the same total
  // every other device sees.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") setReloadKey((k) => k + 1);
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  useEffect(() => {
    if (!username) return;
    fetchStories(username)
      .then(setStories)
      .catch(() => setStories([]));
  }, [username]);

  async function addStory(file: File | null) {
    if (!file || !username) return;
    if (!file.type.startsWith("image/") && !file.type.startsWith("video/")) {
      toast.error("Pick a photo or video");
      return;
    }
    setStoryUploading(true);
    try {
      await postStory(file, username);
      setStories(await fetchStories(username));
      toast.success("Story posted");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't post story");
    } finally {
      setStoryUploading(false);
      if (storyFile.current) storyFile.current.value = "";
    }
  }

  // --- Paged grids ---------------------------------------------------------
  // Every tab loads 30 cards at a time via `.range()`, so a creator with 1,500
  // videos keeps scrolling past the old 1000-row ceiling instead of stopping.

  const loadPage = useCallback(
    async (key: TabKey, offset: number): Promise<{ rows: Video[]; hasMore: boolean }> => {
      if (!username) return { rows: [], hasMore: false };
      if (key === "videos")
        return fetchProfileVideosPage(username, offset, PROFILE_PAGE_SIZE, profile?.id);
      if (!profile?.id) return { rows: [], hasMore: false };
      if (key === "liked") {
        if (!canSeeLiked) return { rows: [], hasMore: false };
        return fetchLikedVideosPage(profile.id, offset, PROFILE_PAGE_SIZE);
      }
      // Vault/Saved is private: only the owner ever reads it.
      if (key === "saved") {
        if (!isOwn) return { rows: [], hasMore: false };
        return fetchSavedVideosPage(profile.id, offset, PROFILE_PAGE_SIZE);
      }
      return fetchRepostedVideosPage(profile.id, offset, PROFILE_PAGE_SIZE);
    },
    [username, profile?.id, canSeeLiked, isOwn],
  );

  const applyRows = useCallback((key: TabKey, rows: Video[], replace: boolean) => {
    const merge = (prev: Video[] | null) => {
      const base = replace ? [] : (prev ?? []);
      const seen = new Set(base.map((v) => v.id));
      return [...base, ...rows.filter((r) => !seen.has(r.id))];
    };
    if (key === "videos") setVideos(merge);
    else if (key === "liked") setLikedVideos(merge);
    else if (key === "saved") setSaved(merge);
    else setReposts(merge);
  }, []);

  // First page for the active tab (and after the viewer closes, so un-likes and
  // deletes are reflected).
  useEffect(() => {
    if (!username) return;
    let alive = true;
    setOpen(null);
    setLoadingMore(true);
    if (tab === "liked") setLikedLoading(true);
    loadPage(tab, 0)
      .then(({ rows, hasMore: more }) => {
        if (!alive) return;
        applyRows(tab, rows, true);
        setHasMore((prev) => ({ ...prev, [tab]: more }));
      })
      .catch(() => {
        if (!alive) return;
        applyRows(tab, [], true);
        setHasMore((prev) => ({ ...prev, [tab]: false }));
      })
      .finally(() => {
        if (!alive) return;
        setLoadingMore(false);
        setLikedLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [tab, username, profile?.id, reloadKey, loadPage, applyRows]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore[tab]) return;
    const current =
      tab === "videos" ? videos : tab === "liked" ? likedVideos : tab === "saved" ? saved : reposts;
    const offset = current?.length ?? 0;
    const key = tab;
    setLoadingMore(true);
    try {
      const { rows, hasMore: more } = await loadPage(key, offset);
      applyRows(key, rows, false);
      setHasMore((prev) => ({ ...prev, [key]: more }));
    } catch {
      setHasMore((prev) => ({ ...prev, [key]: false }));
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, hasMore, tab, videos, likedVideos, saved, reposts, loadPage, applyRows]);

  useEffect(() => {
    fetchMyLikes()
      .then(setLikedIds)
      .catch(() => {});
  }, [open !== null]);
  // Switching tabs always starts the grid from the top.
  useEffect(() => {
    setOpen(null);
  }, [tab]);
  // Vault/Saved is owner-only, so a non-owner can never be left on that tab.
  useEffect(() => {
    if (tab === "saved" && !isOwn) setTab("videos");
  }, [tab, isOwn]);
  useEffect(() => {
    if (open === null) return;
    setViewerActiveIndex(open);
    const el = viewer.current;
    if (el) el.scrollTop = open * el.clientHeight;
  }, [open]);

  // Single source of truth. The header stats and the tab labels both read these
  // exact count-query values — never `array.length`, which is only one page and
  // used to freeze at 1000. Header formats compact, tabs stay exact, but the
  // underlying number is the same variable.
  const videoCount = counts?.videos ?? 0;
  // Liked tab is private when the owner hides it — don't leak the number either.
  const likesGivenCount = canSeeLiked ? (counts?.likes ?? 0) : 0;
  const likesReceivedCount = counts?.likesReceived ?? 0;
  const repostsCount = counts?.reposts ?? 0;
  // Vault/Saved is private, like TikTok: owner sees their real total, everyone
  // else gets 0 and no tab at all.
  const savedCount = isOwn ? (counts?.saved ?? 0) : 0;
  const statCounts: ProfileCounts | null = counts
    ? {
        ...counts,
        videos: videoCount,
        likes: likesGivenCount,
        likesReceived: likesReceivedCount,
        reposts: repostsCount,
        saved: savedCount,
      }
    : null;
  const shownVideos =
    tab === "saved"
      ? saved
      : tab === "reposts"
        ? reposts
        : tab === "liked"
          ? canSeeLiked
            ? (likedVideos ?? [])
            : []
          : videos;
  const displayName = profile?.display_name || username;
  const rawAvatar = avatar;
  const shownAvatar = useCompressedThumbnail(rawAvatar, { maxDim: 200 }) ?? rawAvatar;
  const total = shownVideos?.length ?? 0;
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore[tab] || loadingMore || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, tab, loadingMore, loadMore, total]);

  if (banned && !isOwn) {
    return (
      <div className="min-h-dvh w-full bg-background pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-white">
        <div className="mx-auto max-w-4xl px-4 pt-4">
          <Link to="/" className="inline-flex items-center gap-2 text-sm text-white">
            <ArrowLeft className="h-4 w-4" /> Home
          </Link>
          <div className="flex flex-col items-center gap-3 py-24 text-center">
            <Lock className="h-10 w-10 text-white/75" />
            <h1 className="text-xl font-semibold text-white">{BANNED_TEXT}</h1>
            <p className="max-w-sm text-sm text-white/75">
              @{username} can&apos;t be shown on Coolerup right now.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh w-full bg-background pb-[calc(2rem+env(safe-area-inset-bottom))] pt-[env(safe-area-inset-top)] text-white">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-white">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>

        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="relative">
            <button
              type="button"
              disabled={stories.length === 0}
              onClick={() => setStoryOpen(true)}
              aria-label={stories.length ? "View story" : "Profile photo"}
              className={`rounded-full p-1 ${
                christmas
                  ? "christmas-ring"
                  : stories.length
                    ? "bg-gradient-to-tr from-primary to-pink-500"
                    : ""
              }`}
            >
              <div
                className={`flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-primary ${findItem(equipped.top)?.className ?? ""} text-4xl uppercase text-primary-foreground`}
              >
                {shownAvatar ? (
                  <img
                    src={shownAvatar}
                    alt={displayName}
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  username?.[0]
                )}
              </div>
            </button>
            <OnlineDot
              visible={profilePresence.visible && profilePresence.isOnline}
              size="lg"
              className={isOwn ? "absolute bottom-1 left-1" : "absolute bottom-1 right-1"}
            />
            {isOwn && (
              <>
                <button
                  type="button"
                  onClick={() => storyFile.current?.click()}
                  disabled={storyUploading}
                  aria-label="Add to your story"
                  className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <input
                  ref={storyFile}
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => void addStory(e.target.files?.[0] ?? null)}
                />
              </>
            )}
          </div>
          <div>
            <h1
              className={`flex flex-wrap items-center justify-center gap-2 text-2xl ${findItem(equipped.name)?.className ?? ""}`}
            >
              {findItem(equipped.top)?.emoji} {displayName}
            </h1>
            <p className="flex flex-wrap items-center justify-center gap-1.5 text-sm text-muted-foreground">
              <span>@{username}</span>
            </p>
            {isOwn && mySubscription?.status === "active" && (
              <p className="mt-1 flex justify-center">
                <span className="rounded-full border border-border bg-secondary/60 px-2 py-0.5 text-xs font-medium">
                  {mySubscription.isLifetime
                    ? "Lifetime"
                    : (planById(mySubscription.planId)?.label ?? mySubscription.planId)}{" "}
                  plan
                </span>
              </p>
            )}
            {profilePresence.visible && !profilePresence.isOnline && (
              <div className="mt-0.5 flex justify-center">
                <OnlineStatusSubtitle status={profilePresence} />
              </div>
            )}
          </div>
          {!isOwn && auth.ready && (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => void toggleProfileFollow()}
                disabled={followBusy}
                className="min-w-36 rounded-full bg-white font-bold text-black"
                aria-pressed={following}
              >
                {following ? (
                  <>
                    <UserRoundCheck className="mr-2 h-4 w-4" /> Following
                  </>
                ) : (
                  <>
                    <UserRoundPlus className="mr-2 h-4 w-4" /> Follow
                  </>
                )}
              </Button>
              <ReportButton
                username={username}
                target="profile"
                targetUrl={typeof window !== "undefined" ? window.location.href : null}
                targetText={profile?.bio?.trim() || profile?.display_name?.trim() || `@${username}`}
                thumbnailUrl={avatar}
                className="rounded-full border border-border p-2 text-muted-foreground"
                iconClassName="h-4 w-4"
              />
            </div>
          )}
          {profile?.bio && <p className="max-w-md text-sm text-muted-foreground">{profile.bio}</p>}
          {profile?.links && Object.keys(profile.links).length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {LINK_FIELDS.filter(
                (f) => profile.links?.[f.key] && normalizeLink(profile.links[f.key] as string),
              ).map((f) => (
                <a
                  key={f.key}
                  href={normalizeLink(profile.links![f.key] as string)!}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold"
                >
                  {f.label}
                </a>
              ))}
            </div>
          )}
          {isOwn && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit profile
              </Button>
              <Link
                to="/settings"
                className="inline-flex items-center rounded-md border border-white/25 bg-white px-3 py-1 text-sm font-medium text-black"
              >
                Settings
              </Link>
            </div>
          )}
          <ProfileStats
            counts={statCounts}
            username={username}
            onOpenFollowers={() => setFollowersOpen(true)}
            onOpenFollowing={() => setFollowingOpen(true)}
          />
          {isOwn && <TikTokProfileCard username={username} />}
        </div>

        <div className="mt-4 flex justify-around border-b border-border">
          {TABS.filter((t) => t.key !== "saved" || isOwn).map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            // Exact totals — the very same variables the header uses, so the
            // top stat and the tab can never disagree.
            const n =
              t.key === "videos"
                ? videoCount
                : t.key === "reposts"
                  ? repostsCount
                  : t.key === "liked"
                    ? likesGivenCount
                    : savedCount;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-label={t.label}
                aria-selected={active}
                role="tab"
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 pb-2 pt-1 text-white ${
                  active ? "border-white font-bold" : "border-transparent"
                }`}
              >
                <Icon className={`h-5 w-5 ${active && t.key === "liked" ? "fill-current" : ""}`} />
                <span className="text-xs font-bold tabular-nums">{counts === null ? "–" : n}</span>
              </button>
            );
          })}
        </div>

        {tab === "liked" && !canSeeLiked ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <Lock className="h-7 w-7 text-muted-foreground" />
            </span>
            <p className="text-base font-bold">This user's liked videos are private</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Videos liked by @{username} are hidden by their privacy settings.
            </p>
          </div>
        ) : tab === "liked" && likedLoading && likedVideos === null ? (
          <VideoGridSkeleton count={6} />
        ) : tab === "liked" && likesGivenCount === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary">
              <Heart className="h-7 w-7 text-muted-foreground" />
            </span>
            <p className="text-base font-bold">
              {isOwn ? "No liked videos yet" : "This user has no liked videos"}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {isOwn
                ? "Videos you like will appear here."
                : `Videos @${username} likes will appear here.`}
            </p>
          </div>
        ) : tab === "saved" && savedCount === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No saved videos yet.</p>
        ) : tab === "reposts" && repostsCount === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No reposts yet.</p>
        ) : shownVideos === null ? (
          <VideoGridSkeleton count={6} />
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {shownVideos.map((v, i) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setOpen(i)}
                className="group relative aspect-[3/4] overflow-hidden bg-secondary"
                aria-label={`Open video by @${v.username}`}
              >
                <Thumb url={v.video_url} caption={parseCaption(v.caption || "").text} />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-4 text-[11px] font-bold text-white">
                  <Heart className="h-3 w-3 fill-current" />
                  {v.likes_count || 0}
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === "liked" && isOwn && !showLiked && (
          <p className="flex items-center justify-center gap-2 py-4 text-xs text-muted-foreground">
            <EyeOff className="h-3.5 w-3.5" /> Only you can see your liked videos
          </p>
        )}
        {hasMore[tab] && <div ref={sentinel} className="h-10" />}
        {loadingMore && shownVideos !== null && <FeedLoadingSpinner />}

        {isOwn && (
          <div className="mt-5 space-y-3 px-1">
            <PaidShelf
              title="My Paid Videos"
              hint="You keep 80% of every unlock."
              empty="No paid videos yet. Turn on “Make this video Paid” when you upload."
              loading={myPaid.loading}
              items={myPaid.videos.map((v) => ({
                id: v.id,
                kind: v.kind,
                title: v.title,
                thumbnailUrl: v.thumbnailUrl,
                videoUrl: v.videoUrl,
                priceCents: v.priceCents,
              }))}
              onOpen={setPaidPreview}
            />
            <PaidShelf
              title="Purchased Videos"
              empty="You haven't unlocked any paid videos yet."
              loading={purchased.loading}
              items={purchased.videos.map((v) => ({
                id: v.videoId,
                kind: v.kind,
                title: v.caption || "Paid video",
                thumbnailUrl: v.thumbnailUrl,
                videoUrl: v.videoUrl,
                priceCents: v.amountCents,
                subtitle: v.username ? `@${v.username}` : undefined,
              }))}
              onOpen={setPaidPreview}
            />
          </div>
        )}
      </div>

      <Dialog open={paidPreview !== null} onOpenChange={(o) => !o && setPaidPreview(null)}>
        <DialogContent className="max-w-md border-white/10 bg-black p-0 text-white">
          <DialogHeader className="px-4 pb-1 pt-4">
            <DialogTitle className="text-sm font-bold text-white">
              {paidPreview?.title || "Paid video"}
            </DialogTitle>
          </DialogHeader>
          {paidPreview && (
            <div className="relative aspect-[9/16] w-full overflow-hidden bg-black">
              <video
                src={paidPreviewSrc}
                controls
                playsInline
                className="h-full w-full object-contain"
              />
              <PaidVideoGate
                videoId={paidPreview.id}
                kind={paidPreview.kind}
                priceCents={paidPreview.priceCents}
                title={paidPreview.title}
                thumbnailUrl={paidPreview.thumbnailUrl}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

      {open !== null && shownVideos && (
        <div className="fixed inset-0 z-40 bg-black">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setOpen(null);
              setReloadKey((k) => k + 1);
            }}
            className="absolute left-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white"
          >
            <X />
          </Button>
          <div
            ref={viewer}
            className="h-dvh snap-y snap-mandatory overflow-y-scroll"
            onScroll={(e) => {
              const el = e.currentTarget;
              const vh = el.clientHeight || window.innerHeight || 1;
              const nextIdx = Math.max(0, Math.round(el.scrollTop / vh));
              setViewerActiveIndex((cur) => (cur === nextIdx ? cur : nextIdx));
              // Near the last loaded card? Pull the next page so the viewer can
              // keep swiping through every video, not just the first 10.
              if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 2) {
                void loadMore();
              }
            }}
          >
            {shownVideos.map((v, i) => {
              const preloadMode = preloadModeFor(i, viewerActiveIndex, { lite });
              return (
                <div key={v.id} className="h-dvh snap-start snap-always">
                  <VideoCard
                    video={v}
                    liked={likedIds.has(v.id)}
                    muted={muted}
                    preloadMode={preloadMode}
                    onToggleMute={() => setMuted((m) => !m)}
                    onLikeChange={(on) =>
                      setLikedIds((prev) => {
                        const n = new Set(prev);
                        if (on) n.add(v.id);
                        else n.delete(v.id);
                        return n;
                      })
                    }
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {storyOpen && stories.length > 0 && (
        <StoryViewer
          stories={stories}
          isOwn={isOwn}
          onClose={() => setStoryOpen(false)}
          onDeleted={(id) => setStories((p) => p.filter((s) => s.id !== id))}
          onLikeChange={(id, _liked, count) =>
            setStories((p) => p.map((s) => (s.id === id ? { ...s, likes_count: count } : s)))
          }
        />
      )}

      {isOwn && <EditProfileDialog open={editing} onOpenChange={setEditing} />}

      <Dialog open={followingOpen} onOpenChange={setFollowingOpen}>
        <DialogContent className="max-h-[80dvh] max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Following</DialogTitle>
          </DialogHeader>
          <div
            ref={followingScrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (
                followingHasMore &&
                !followingLoadingMore &&
                el.scrollTop + el.clientHeight >= el.scrollHeight - 80
              ) {
                void loadFollowingPage(true);
              }
            }}
            className="-mx-6 max-h-[60dvh] overflow-y-auto px-6"
          >
            {followingUsers === null ? (
              <ListRowSkeleton count={5} />
            ) : followingUsers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                @{username} isn't following anyone yet.
              </p>
            ) : (
              <>
                <ul className="divide-y">
                  {followingUsers.map((u) => {
                    const st = dialogPresence[normalizePresenceHandle(u.handle)] ?? {
                      visible: false,
                      isOnline: false,
                      statusText: null,
                    };
                    return (
                      <li key={u.handle}>
                        <Link
                          to="/u/$username"
                          params={{ username: u.handle }}
                          onClick={() => setFollowingOpen(false)}
                          className="flex items-center gap-3 py-3"
                        >
                          <div className="relative shrink-0">
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm uppercase text-primary-foreground">
                              {u.avatar ? (
                                <FollowAvatarImg
                                  avatar={u.avatar}
                                  alt={u.display_name || u.handle}
                                />
                              ) : (
                                u.handle[0]
                              )}
                            </div>
                            <OnlineDot
                              visible={st.visible && st.isOnline}
                              size="md"
                              className="absolute bottom-0 right-0"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {u.display_name || u.handle}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">@{u.handle}</p>
                            {st.visible && !st.isOnline && st.statusText && (
                              <OnlineStatusSubtitle status={st} className="block truncate" />
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {followingHasMore && (
                  <div ref={followingSentinelRef} className="h-3 w-full" aria-hidden="true" />
                )}
                {followingLoadingMore && <ListRowSkeleton count={2} />}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={followersOpen} onOpenChange={setFollowersOpen}>
        <DialogContent className="max-h-[80dvh] max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Followers</DialogTitle>
          </DialogHeader>
          <div
            ref={followersScrollRef}
            onScroll={(e) => {
              const el = e.currentTarget;
              if (
                followersHasMore &&
                !followersLoadingMore &&
                el.scrollTop + el.clientHeight >= el.scrollHeight - 80
              ) {
                void loadFollowersPage(true);
              }
            }}
            className="-mx-6 max-h-[60dvh] overflow-y-auto px-6"
          >
            {followersUsers === null ? (
              <ListRowSkeleton count={5} />
            ) : followersUsers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                @{username} doesn't have any followers yet.
              </p>
            ) : (
              <>
                <ul className="divide-y">
                  {followersUsers.map((u) => {
                    const st = dialogPresence[normalizePresenceHandle(u.handle)] ?? {
                      visible: false,
                      isOnline: false,
                      statusText: null,
                    };
                    return (
                      <li key={u.handle}>
                        <Link
                          to="/u/$username"
                          params={{ username: u.handle }}
                          onClick={() => setFollowersOpen(false)}
                          className="flex items-center gap-3 py-3"
                        >
                          <div className="relative shrink-0">
                            <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-primary text-sm uppercase text-primary-foreground">
                              {u.avatar ? (
                                <FollowAvatarImg
                                  avatar={u.avatar}
                                  alt={u.display_name || u.handle}
                                />
                              ) : (
                                u.handle[0]
                              )}
                            </div>
                            <OnlineDot
                              visible={st.visible && st.isOnline}
                              size="md"
                              className="absolute bottom-0 right-0"
                            />
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">
                              {u.display_name || u.handle}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">@{u.handle}</p>
                            {st.visible && !st.isOnline && st.statusText && (
                              <OnlineStatusSubtitle status={st} className="block truncate" />
                            )}
                          </div>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
                {followersHasMore && (
                  <div ref={followersSentinelRef} className="h-3 w-full" aria-hidden="true" />
                )}
                {followersLoadingMore && <ListRowSkeleton count={2} />}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
