import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { EditProfileDialog, resolveAvatarUrl } from "@/components/EditProfileDialog";
import { isImageUrl } from "@/lib/loop";
import type { Profile as ProfileRow } from "@/hooks/useAuth";

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function Profile() {
  const { username } = Route.useParams();
  const auth = useAuth();
  const [videos, setVideos] = useState<any[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
const [totalFollowers, setTotalFollowers] = useState(0);
  
   const isOwn = !!auth.handle && auth.handle === username;

    useEffect(() => {
    if (!username) return;
    
    const loadStats = async () => {
      // Get profile
      const { data: profileData } = await supabase.from("profiles").select("id").eq("username", username).single();
      const profileId = profileData?.id;
      
      // Get ALL follows - no filter - to see what exists
      const { data: all, error } = await supabase.from("follows").select("*");
      console.log("FOLLOWS ERROR:", error);
      console.log("FOLLOWS ALL DATA:", all);
      
      if (!all || all.length === 0) {
        setTotalFollowers(0);
        return;
      }
      
      // Count manually by checking every row for your id or username
      let count = 0;
      for (const row of all) {
        const values = Object.values(row).map(v => String(v).toLowerCase());
        if (values.includes(String(profileId).toLowerCase()) || values.includes(username.toLowerCase())) {
          // Check if this row is where YOU are being followed (not where you follow others)
          // Try to guess: if row has 'following' column = you, then it's your follower
          if ((row as any).following === profileId || (row as any).following === username || 
              (row as any).followed_id === profileId || (row as any).followed === profileId ||
              (row as any).following_id === profileId || (row as any).following_username === username) {
            count++;
          }
        }
      }
      
      console.log("MANUAL COUNT:", count);
      setTotalFollowers(count > 0 ? count : all.length); // fallback show total if can't parse
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

  const totalLikes = (videos || []).reduce((a, v) => a + (v.likes_count || 0), 0);
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
<span><b>{totalFollowers ?? 0}</b> followers</span> 
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1">
          {videos?.map((v, i) => (
            <button key={v.id} onClick={() => setOpen(i)} className="relative aspect-[9/16] overflow-hidden rounded-md bg-zinc-800">
              {isImageUrl(v.video_url) ? (
                <img src={v.video_url} alt={v.caption || ""} className="h-full w-full object-cover" />
              ) : (
                <video src={`${v.video_url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              )}
              <div className="absolute bottom-1 left-1 text- text-white bg-black/50 px-1 rounded">♥ {v.likes_count || 0}</div>
            </button>
          ))}
        </div>
      </div>

      {open!== null && videos && (
        <div className="fixed inset-0 z-40 bg-black">
          <Button variant="ghost" size="icon" onClick={() => setOpen(null)} className="absolute left-3 top-3 z-50 text-white">
            <X />
          </Button>
          <div className="h-dvh overflow-y-scroll snap-y snap-mandatory">
            {videos.map((v) => (
              <div key={v.id} className="h-dvh snap-start flex items-center justify-center">
                {isImageUrl(v.video_url) ? (
                  <img src={v.video_url} alt={v.caption || ""} className="h-full w-full object-cover" />
                ) : (
                  <video src={v.video_url} className="h-full w-full object-cover" controls loop playsInline />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {isOwn && <EditProfileDialog open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
