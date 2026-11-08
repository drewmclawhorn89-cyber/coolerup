import { findItem, useEquipped } from "@/lib/shop";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { VideoCard } from "@/components/VideoCard";
import { StoryViewer } from "@/components/StoryViewer";
import { fetchStories, postStory, type Story } from "@/lib/stories";
import { useChristmasMode } from "@/lib/christmas";
import { toast } from "sonner";
import { followUser, isFollowing as checkIsFollowing, unfollowUser } from "@/lib/follow";
import type { Profile as ProfileRow } from "@/hooks/useAuth";

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function Thumb({ url, caption }: { url: string; caption: string }) {
  const [src, setSrc] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
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
  if (!src) return <div ref={boxRef} className="h-full w-full" />;
  const isImage = isImageUrl(url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(url);
  return isImage ? (
    <img src={src} alt={caption} className="h-full w-full object-cover" />
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

function Profile() {
  const { username } = Route.useParams();
  const auth = useAuth();
  // Red/green ring instead of the usual pink gradient, Nov 15 2026 -> Jan 1 2027.
  const christmas = useChristmasMode();
  const [counts, setCounts] = useState<ProfileCounts | null>(null);
  const [videos, setVideos] = useState<Video[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
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
  const [followersOpen, setFollowersOpen] = useState(false);
  const [followersUsers, setFollowersUsers] = useState<FollowingUser[] | null>(null);

  const equipped = useEquipped(username);
  const isOwn = !!auth.handle && auth.handle === username;
  const showLiked = profile?.show_liked !== false;
  const canSeeLiked = showLiked || isOwn;

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

  useEffect(() => {
    if (!followingOpen || !username) return;
    let alive = true;
    setFollowingUsers(null);
    (async () => {
      const { data: rows } = await supabase
        .from("follows")
        .select("following_username")
        .eq("follower_username", username)
        .order("created_at", { ascending: false })
        .limit(200);
      const handles = (rows ?? []).map((r) => r.following_username);
      if (handles.length === 0) {
        if (alive) setFollowingUsers([]);
        return;
      }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("handle, display_name, avatar_url")
        .in("handle", handles);
      const byHandle = new Map((profiles ?? []).map((p) => [p.handle, p]));
      const list = await Promise.all(
        handles.map(async (handle) => {
          const p = byHandle.get(handle);
          return {
            handle,
            display_name: p?.display_name ?? null,
            avatar: await resolveAvatarUrl(p?.avatar_url),
          } as FollowingUser;
        }),
      );
      if (alive) setFollowingUsers(list);
    })();
    return () => {
      alive = false;
    };
  }, [followingOpen, username]);

  useEffect(() => {
    if (!followersOpen || !username) return;
    let alive = true;
    setFollowersUsers(null);
    (async () => {
      const { data: rows } = await supabase
        .from("follows")
        .select("follower_username")
        .eq("following_username", username)
        .order("created_at", { ascending: false })
        .limit(200);
      const handles = Array.from(
        new Set((rows ?? []).map((r) => r.follower_username).filter(Boolean)),
      );
      if (handles.length === 0) {
        if (alive) setFollowersUsers([]);
        return;
      }
      const { data: profiles } = await supabase
        .from("profiles")
        .select("handle, display_name, avatar_url")
        .in("handle", handles);
      const byHandle = new Map((profiles ?? []).map((p) => [p.handle, p]));
      const list = await Promise.all(
        handles.map(async (handle) => {
          const p = byHandle.get(handle);
          return {
            handle,
            display_name: p?.display_name ?? null,
            avatar: await resolveAvatarUrl(p?.avatar_url),
          } as FollowingUser;
        }),
      );
      if (alive) setFollowersUsers(list);
    })();
    return () => {
      alive = false;
    };
  }, [followersOpen, username]);

  useEffect(() => {
    if (!username) return;
    supabase
      .from("profiles")
      .select("*")
      .eq("handle", username)
      .maybeSingle()
      .then(({ data }) => {
        const row = (data as ProfileRow | null) ?? null;
        setProfile(row);
        resolveAvatarUrl(row?.avatar_url).then(setAvatar);
      });
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
    } catch (e: any) {
      toast.error(e?.message || "Couldn't post story");
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
      if (key === "videos") return fetchProfileVideosPage(username, offset, PROFILE_PAGE_SIZE);
      if (!profile?.id) return { rows: [], hasMore: false };
      if (key === "liked") {
        if (!canSeeLiked) return { rows: [], hasMore: false };
        return fetchLikedVideosPage(profile.id, offset, PROFILE_PAGE_SIZE);
      }
      if (key === "saved") return fetchSavedVideosPage(profile.id, offset, PROFILE_PAGE_SIZE);
      return fetchRepostedVideosPage(profile.id, offset, PROFILE_PAGE_SIZE);
    },
    [username, profile?.id, canSeeLiked],
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
  useEffect(() => {
    if (open === null) return;
    const el = viewer.current;
    if (el) el.scrollTop = open * el.clientHeight;
  }, [open]);

  // Exact totals from count queries — never array lengths.
  const totalLikes = counts?.likesReceived ?? 0;
  // TikTok shows two different numbers: likes received and videos liked.
  const likedCount = counts?.likes ?? likedVideos?.length ?? 0;
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
  const total = shownVideos?.length ?? 0;
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore[tab] || loadingMore) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) void loadMore();
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, tab, loadingMore, loadMore, total]);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
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
                {avatar ? (
                  <img src={avatar} alt={displayName} className="h-full w-full object-cover" />
                ) : (
                  username?.[0]
                )}
              </div>
            </button>
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
            <h1 className={`text-2xl ${findItem(equipped.name)?.className ?? ""}`}>
              {findItem(equipped.top)?.emoji} {displayName}
            </h1>
            <p className="text-sm text-muted-foreground">@{username}</p>
          </div>
          {!isOwn && auth.ready && (
            <Button
              type="button"
              onClick={() => void toggleProfileFollow()}
              disabled={followBusy}
              variant={following ? "outline" : "default"}
              className={`min-w-36 rounded-full font-bold ${
                following ? "border-border" : "bg-[#fe2c55] text-white hover:bg-[#e9274d]"
              }`}
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
                  className="rounded-full border border-border px-3 py-1 text-xs font-semibold hover:bg-accent"
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
                className="inline-flex items-center rounded-md border px-3 py-1 text-sm"
              >
                Settings
              </Link>
            </div>
          )}
          <ProfileStats
            counts={counts}
            username={username}
            onOpenFollowers={() => setFollowersOpen(true)}
            onOpenFollowing={() => setFollowingOpen(true)}
          />
        </div>

        <div className="mt-4 flex justify-around border-b border-border">
          {TABS.map((t) => {
            const active = tab === t.key;
            const Icon = t.icon;
            // Exact totals from the count queries, not the loaded page size.
            const n =
              t.key === "videos"
                ? (counts?.videos ?? videos?.length ?? 0)
                : t.key === "reposts"
                  ? (counts?.reposts ?? reposts.length)
                  : t.key === "liked"
                    ? likedCount
                    : (counts?.saved ?? saved.length);
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-label={t.label}
                aria-selected={active}
                role="tab"
                className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 pb-2 pt-1 transition-colors ${
                  active
                    ? "border-foreground text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground/80"
                }`}
              >
                <Icon className={`h-5 w-5 ${active && t.key === "liked" ? "fill-current" : ""}`} />
                <span className="text-xs font-bold tabular-nums">{n}</span>
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
          <div className="grid grid-cols-3 gap-1">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse bg-secondary" />
            ))}
          </div>
        ) : tab === "liked" && likedCount === 0 ? (
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
        ) : tab === "saved" && (counts?.saved ?? saved.length) === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No saved videos yet.</p>
        ) : tab === "reposts" && (counts?.reposts ?? reposts.length) === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">No reposts yet.</p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {shownVideos?.map((v, i) => (
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
        {loadingMore && (
          <p className="py-4 text-center text-xs text-muted-foreground">Loading more…</p>
        )}
      </div>

      {open !== null && shownVideos && (
        <div className="fixed inset-0 z-40 bg-black">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              setOpen(null);
              setReloadKey((k) => k + 1);
            }}
            className="absolute left-3 top-3 z-50 text-white"
          >
            <X />
          </Button>
          <div
            ref={viewer}
            className="h-dvh snap-y snap-mandatory overflow-y-scroll"
            onScroll={(e) => {
              const el = e.currentTarget;
              // Near the last loaded card? Pull the next page so the viewer can
              // keep swiping through every video, not just the first 30.
              if (el.scrollHeight - el.scrollTop - el.clientHeight < el.clientHeight * 2) {
                void loadMore();
              }
            }}
          >
            {shownVideos.map((v) => (
              <div key={v.id} className="h-dvh snap-start snap-always">
                <VideoCard
                  video={v}
                  liked={likedIds.has(v.id)}
                  muted={muted}
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
            ))}
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
          <div className="-mx-6 max-h-[60dvh] overflow-y-auto px-6">
            {followingUsers === null ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                    <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : followingUsers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                @{username} isn't following anyone yet.
              </p>
            ) : (
              <ul className="divide-y">
                {followingUsers.map((u) => (
                  <li key={u.handle}>
                    <Link
                      to="/u/$username"
                      params={{ username: u.handle }}
                      onClick={() => setFollowingOpen(false)}
                      className="flex items-center gap-3 py-3 hover:opacity-80"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm uppercase text-primary-foreground">
                        {u.avatar ? (
                          <img
                            src={u.avatar}
                            alt={u.display_name || u.handle}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          u.handle[0]
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {u.display_name || u.handle}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">@{u.handle}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={followersOpen} onOpenChange={setFollowersOpen}>
        <DialogContent className="max-h-[80dvh] max-w-md overflow-hidden">
          <DialogHeader>
            <DialogTitle>Followers</DialogTitle>
          </DialogHeader>
          <div className="-mx-6 max-h-[60dvh] overflow-y-auto px-6">
            {followersUsers === null ? (
              <div className="space-y-2 py-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3 py-2">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                    <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  </div>
                ))}
              </div>
            ) : followersUsers.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">
                @{username} doesn't have any followers yet.
              </p>
            ) : (
              <ul className="divide-y">
                {followersUsers.map((u) => (
                  <li key={u.handle}>
                    <Link
                      to="/u/$username"
                      params={{ username: u.handle }}
                      onClick={() => setFollowersOpen(false)}
                      className="flex items-center gap-3 py-3 hover:opacity-80"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-sm uppercase text-primary-foreground">
                        {u.avatar ? (
                          <img
                            src={u.avatar}
                            alt={u.display_name || u.handle}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          u.handle[0]
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {u.display_name || u.handle}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">@{u.handle}</p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
