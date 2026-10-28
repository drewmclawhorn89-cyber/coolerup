import { findItem, useEquipped } from "@/lib/shop";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import {
  EditProfileDialog,
  LINK_FIELDS,
  normalizeLink,
  resolveAvatarUrl,
} from "@/components/EditProfileDialog";
import {
  fetchSavedVideos,
  fetchRepostedVideos,
  fetchLikedVideos,
  fetchMyLikes,
  isImageUrl,
  parseCaption,
  resolveVideoUrl,
} from "@/lib/loop";
import { VideoCard } from "@/components/VideoCard";
import { StoryViewer } from "@/components/StoryViewer";
import { fetchStories, postStory, type Story } from "@/lib/stories";
import { toast } from "sonner";
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

function Profile() {
  const { username } = Route.useParams();
  const auth = useAuth();
  const [videos, setVideos] = useState<any[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [muted, setMuted] = useState(false);
  const [tab, setTab] = useState<"videos" | "liked" | "saved" | "reposts">("videos");
  const [saved, setSaved] = useState<any[]>([]);
  const [reposts, setReposts] = useState<any[]>([]);
  const [likedVideos, setLikedVideos] = useState<any[]>([]);
  const viewer = useRef<HTMLDivElement>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [storyOpen, setStoryOpen] = useState(false);
  const [storyUploading, setStoryUploading] = useState(false);
  const storyFile = useRef<HTMLInputElement>(null);
  const [totalFollowers, setTotalFollowers] = useState(0);
  const [totalFollowing, setTotalFollowing] = useState(0);
  const [followingOpen, setFollowingOpen] = useState(false);
  const [followingUsers, setFollowingUsers] = useState<FollowingUser[] | null>(null);
  const [followersOpen, setFollowersOpen] = useState(false);
  const [followersUsers, setFollowersUsers] = useState<FollowingUser[] | null>(null);

  const equipped = useEquipped(username);
  const isOwn = !!auth.handle && auth.handle === username;

  useEffect(() => {
    if (!username) return;

    const loadStats = async () => {
      const [followers, following] = await Promise.all([
        supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("following_username", username),
        supabase
          .from("follows")
          .select("id", { count: "exact", head: true })
          .eq("follower_username", username),
      ]);
      setTotalFollowers(followers.count ?? 0);
      setTotalFollowing(following.count ?? 0);
    };

    loadStats();
  }, [username]);

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
      .from("videos")
      .select("*")
      .eq("username", username)
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        setVideos(data || []);
      });
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

  useEffect(() => {
    if (!profile?.id) return;
    fetchSavedVideos(profile.id)
      .then(setSaved)
      .catch(() => {});
  }, [profile?.id, tab]);
  useEffect(() => {
    if (!profile?.id) return;
    fetchRepostedVideos(profile.id)
      .then(setReposts)
      .catch(() => {});
  }, [profile?.id, tab]);
  useEffect(() => {
    if (!profile?.id) return;
    fetchLikedVideos(profile.id)
      .then(setLikedVideos)
      .catch(() => {});
  }, [profile?.id, tab]);
  useEffect(() => {
    fetchMyLikes()
      .then(setLikedIds)
      .catch(() => {});
  }, [open !== null]);
  useEffect(() => {
    if (open === null) return;
    const el = viewer.current;
    if (el) el.scrollTop = open * el.clientHeight;
  }, [open]);

  const totalLikes = (videos || []).reduce((a, v) => a + (v.likes_count || 0), 0);
  const shownVideos =
    tab === "saved" ? saved : tab === "reposts" ? reposts : tab === "liked" ? likedVideos : videos;
  const displayName = profile?.display_name || username;
  const PAGE = 12;
  const [count, setCount] = useState(PAGE);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setCount(PAGE);
  }, [username, tab]);
  const total = shownVideos?.length ?? 0;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= total) return;
    const obs = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) setCount((c) => c + PAGE);
      },
      { rootMargin: "400px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [count, total]);

  return (
    <div className="min-h-dvh bg-black text-white">
      <div className="mx-auto max-w-[430px] px-4 pb-[70px] pt-4">
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
              className={`rounded-full p-1 ${stories.length ? "bg-gradient-to-tr from-primary to-pink-500" : ""}`}
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
          {profile?.bio && <p className="max-w-md text-sm text-muted-foreground">{profile.bio}</p>}
          {profile?.links && Object.keys(profile.links).length > 0 && (
            <div className="flex flex-wrap justify-center gap-2">
              {LINK_FIELDS.filter(
                (f) => profile.links?.[f.key] && normalizeLink(profile.links[f.key]),
              ).map((f) => (
                <a
                  key={f.key}
                  href={normalizeLink(profile.links![f.key])!}
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
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center rounded border border-[#333] px-4 py-1 text-[14px] font-semibold text-white transition hover:bg-white/10"
              >
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit profile
              </button>
              <Link
                to="/settings"
                className="inline-flex items-center rounded border border-[#333] px-4 py-1 text-[14px] font-semibold text-white transition hover:bg-white/10"
              >
                Settings
              </Link>
            </div>
          )}
          <div className="flex items-center justify-center gap-8">
            <button
              type="button"
              onClick={() => setFollowingOpen(true)}
              aria-label={`View accounts @${username} is following`}
              className="flex flex-col items-center"
            >
              <span className="text-[17px] font-bold text-white">{totalFollowing}</span>
              <span className="text-[13px] text-white/60">Following</span>
            </button>
            <button
              type="button"
              onClick={() => setFollowersOpen(true)}
              aria-label={`View accounts following @${username}`}
              className="flex flex-col items-center"
            >
              <span className="text-[17px] font-bold text-white">{totalFollowers}</span>
              <span className="text-[13px] text-white/60">Followers</span>
            </button>
            <div className="flex flex-col items-center">
              <span className="text-[17px] font-bold text-white">{totalLikes ?? 0}</span>
              <span className="text-[13px] text-white/60">Likes</span>
            </div>
          </div>
        </div>

        <div className="mb-0 flex border-b border-[#222]">
          {(["videos", "liked", "saved", "reposts"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2.5 text-[14px] capitalize transition-colors ${
                tab === t
                  ? "border-b-2 border-white font-bold text-white"
                  : "text-white/60 hover:text-white"
              }`}
            >
              {t === "saved"
                ? `Saved (${saved.length})`
                : t === "reposts"
                  ? `Reposts (${reposts.length})`
                  : t === "liked"
                    ? `Liked (${likedVideos.length})`
                    : "Videos"}
            </button>
          ))}
        </div>

        {tab === "saved" && saved.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No saved videos yet.</p>
        )}
        {tab === "reposts" && reposts.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No reposts yet.</p>
        )}
        <div className="grid grid-cols-3 gap-[1px]">
          {shownVideos?.slice(0, count).map((v, i) => (
            <button
              key={v.id}
              onClick={() => setOpen(i)}
              className="relative aspect-[9/16] overflow-hidden bg-zinc-800"
            >
              <Thumb url={v.video_url} caption={parseCaption(v.caption || "").text} />
              <div className="absolute bottom-1 left-1 text- text-white bg-black/50 px-1 rounded">
                ♥ {v.likes_count || 0}
              </div>
            </button>
          ))}
        </div>
        {count < total && <div ref={sentinel} className="h-10" />}
      </div>

      {open !== null && shownVideos && (
        <div className="fixed inset-0 z-40 bg-black">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setOpen(null)}
            className="absolute left-3 top-3 z-50 text-white"
          >
            <X />
          </Button>
          <div ref={viewer} className="h-dvh snap-y snap-mandatory overflow-y-scroll">
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
