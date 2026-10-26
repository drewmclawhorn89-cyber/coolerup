import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { EditProfileDialog, resolveAvatarUrl } from "@/components/EditProfileDialog";
import { fetchSavedVideos, fetchMyLikes, isImageUrl, parseCaption, resolveVideoUrl } from "@/lib/loop";
import { VideoCard } from "@/components/VideoCard";
import type { Profile as ProfileRow } from "@/hooks/useAuth";

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function Thumb({ url, caption }: { url: string; caption: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    let alive = true;
    resolveVideoUrl(url).then((u) => { if (alive) setSrc(u); });
    return () => { alive = false; };
  }, [url]);
  if (!src) return null;
  const isImage = isImageUrl(url) || /\.(jpe?g|png|webp|gif|avif)$/i.test(url);
  return isImage
    ? <img src={src} alt={caption} loading="lazy" decoding="async" className="h-full w-full object-cover" />
    : <video src={`${src}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />;
}

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
  const [tab, setTab] = useState<"videos" | "saved">("videos");
  const [saved, setSaved] = useState<any[]>([]);
  const viewer = useRef<HTMLDivElement>(null);
const [totalFollowers, setTotalFollowers] = useState(0);
  const [totalFollowing, setTotalFollowing] = useState(0);
  
   const isOwn = !!auth.handle && auth.handle === username;

    useEffect(() => {
    if (!username) return;
    
    const loadStats = async () => {
      const [followers, following] = await Promise.all([
        supabase.from("follows").select("id", { count: "exact", head: true }).eq("following_username", username),
        supabase.from("follows").select("id", { count: "exact", head: true }).eq("follower_username", username),
      ]);
      setTotalFollowers(followers.count ?? 0);
      setTotalFollowing(following.count ?? 0);
    };

    loadStats();
  }, [username]);
 
  useEffect(() => {
    if (!username) return;
    supabase.from("videos").select("*").eq("username", username).order("created_at", { ascending: false }).then(({ data }) => {
      setVideos(data || []);
    });
    supabase.from("profiles").select("id, handle, display_name, bio, avatar_url").eq("handle", username).maybeSingle().then(({ data }) => {
      const row = (data as ProfileRow | null) ?? null;
      setProfile(row);
      resolveAvatarUrl(row?.avatar_url).then(setAvatar);
    });
  }, [username, auth.profile?.avatar_url, auth.profile?.display_name, auth.profile?.bio]);

  useEffect(() => {
    if (!profile?.id) return;
    fetchSavedVideos(profile.id).then(setSaved).catch(() => {});
  }, [profile?.id, tab]);
  useEffect(() => { fetchMyLikes().then(setLikedIds).catch(() => {}); }, [open !== null]);
  useEffect(() => {
    if (open === null) return;
    const el = viewer.current;
    if (el) el.scrollTop = open * el.clientHeight;
  }, [open]);

  const totalLikes = (videos || []).reduce((a, v) => a + (v.likes_count || 0), 0);
  const shownVideos = tab === "saved" ? saved : videos;
  const displayName = profile?.display_name || username;

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>

        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-full bg-primary text-4xl uppercase text-primary-foreground">
            {avatar ? <img src={avatar} alt={displayName} className="h-full w-full object-cover" /> : username?.[0]}
          </div>
          <div>
            <h1 className="text-2xl">{displayName}</h1>
            <p className="text-sm text-muted-foreground">@{username}</p>
          </div>
          {profile?.bio && <p className="max-w-md text-sm text-muted-foreground">{profile.bio}</p>}
          {isOwn && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="mr-2 h-3.5 w-3.5" /> Edit profile
              </Button>
              <Link to="/settings" className="inline-flex items-center rounded-md border px-3 py-1 text-sm">
                Settings
              </Link>
            </div>
          )}
          <div className="flex gap-8 text-sm">
          <span><b>{videos?.length ?? "-"}</b> videos</span>
<span><b>{totalLikes ?? 0}</b> likes</span>
<span><b>{totalFollowers}</b> followers</span>
<span><b>{totalFollowing}</b> following</span>
          </div>
        </div>

        {(
          <div className="mb-3 flex border-b">
            {(["videos", "saved"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`flex-1 py-2 text-sm font-bold capitalize ${tab === t ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}
              >
                {t === "saved" ? `Saved (${saved.length})` : "Videos"}
              </button>
            ))}
          </div>
        )}

        {tab === "saved" && saved.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">No saved videos yet.</p>
        )}
        <div className="grid grid-cols-3 gap-1">
          {shownVideos?.map((v, i) => (
            <button key={v.id} onClick={() => setOpen(i)} className="relative aspect-[9/16] overflow-hidden rounded-md bg-zinc-800">
              <Thumb url={v.video_url} caption={parseCaption(v.caption || "").text} />
              <div className="absolute bottom-1 left-1 text- text-white bg-black/50 px-1 rounded">♥ {v.likes_count || 0}</div>
            </button>
          ))}
        </div>
      </div>

      {open!== null && shownVideos && (
        <div className="fixed inset-0 z-40 bg-black">
          <Button variant="ghost" size="icon" onClick={() => setOpen(null)} className="absolute left-3 top-3 z-50 text-white">
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
                  onLikeChange={(on) => setLikedIds((prev) => { const n = new Set(prev); if (on) n.add(v.id); else n.delete(v.id); return n; })}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {isOwn && <EditProfileDialog open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
