import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { X, ArrowLeft, Edit3, Save } from "lucide-react";

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function formatCount(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function Profile() {
  const { username } = Route.useParams();
  const [videos][setVideos] = useState<any[] | null>(null);
  const [open][setOpen] = useState<number | null>(null);
  const [isMe][setIsMe] = useState(false);
  const [editing][setEditing] = useState(false);
  const [bio][setBio] = useState("");
  const [newUsername][setNewUsername] = useState(username);
  const [myId][setMyId] = useState<string | null>(null);

  useEffect(() => {
    if (!username) return;
    setNewUsername(username);
    supabase.from("videos").select("*").eq("username", username).then(({ data }) => setVideos(data));
    supabase.from("profiles").select("*").eq("username", username).maybeSingle().then(({ data }) => {
      if (data?.bio) setBio(data.bio);
    });
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setMyId(data.user.id);
      const { data: myProfile } = await supabase.from("profiles").select("username,bio").eq("user_id", data.user.id).maybeSingle();
      if (myProfile?.username === username) {
        setIsMe(true);
        if (myProfile.bio) setBio(myProfile.bio);
      } else {
        const meta = data.user.user_metadata?.username;
        const emailName = data.user.email?.split("@")[0];
        if (meta === username || emailName === username) setIsMe(true);
      }
    });
  }, [username]);

  const saveProfile = async () => {
    if (!myId) return;
    await supabase.from("profiles").upsert({ user_id: myId, username: newUsername, bio }, { onConflict: "user_id" });
    await supabase.auth.updateUser({ data: { username: newUsername, bio } });
    if (newUsername!== username) {
      window.location.href = `/u/${newUsername}`;
    } else {
      setEditing(false);
    }
  };

  const totalLikes = (videos?? []).reduce((a: any, v: any) => a + (v.likes_count || 0), 0);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Home</Link>
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-4xl uppercase text-primary-foreground">{username?.[0]}</div>
          <h1 className="text-2xl">@{username}</h1>
          {editing? (
            <div className="w-full max-w-sm space-y-3">
              <input value={newUsername} onChange={e => setNewUsername(e.target.value)} className="w-full rounded-md border p-2 text-sm" placeholder="Username" />
              <textarea value={bio} onChange={e => setBio(e.target.value)} className="w-full rounded-md border p-2 text-sm" rows={3} placeholder="Your bio..." />
              <Button onClick={saveProfile} size="sm" className="w-full"><Save className="mr-2 h-4 w-4"/> Save profile</Button>
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground max-w-sm">{bio || "No bio yet."}</p>
          )}
          <div className="flex gap-8 text-sm"><span><b>{videos?.length?? "-"}</b> videos</span><span><b>{formatCount(totalLikes)}</b> likes</span></div>
          {isMe &&!editing && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Edit3 className="mr-2 h-4 w-4"/> Edit profile</Button>}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {videos?.map((v: any, i: number) => (
            <button key={v.id} onClick={() => setOpen(i)} className="relative aspect-[9/16] overflow-hidden rounded-md bg-zinc-800">
              <video src={`${v.video_url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              <span className="absolute bottom-1 left-2 text-xs font-bold text-white">{formatCount(v.likes_count)} likes</span>
            </button>
          ))}
        </div>
      </div>
      {open!== null && videos && (
        <div className="fixed inset-0 z-40 bg-black">
          <Button variant="ghost" size="icon" onClick={() => setOpen(null)} className="absolute left-3 top-3 z-50 text-white"><X /></Button>
          <div className="h-dvh overflow-y-scroll snap-y snap-mandatory">
            {videos.map((v: any) => (
              <div key={v.id} className="h-dvh snap-start flex items-center justify-center">
                <video src={v.video_url} className="h-full w-full object-cover" controls loop playsInline />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
