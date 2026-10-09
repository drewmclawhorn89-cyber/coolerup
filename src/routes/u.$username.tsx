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

type Video = {
  id: string;
  video_url: string;
  likes_count: number;
  username: string;
};

function Profile() {
  const { username } = Route.useParams();
  const [videos][setVideos] = useState<Video[] | null>(null);
  const [open][setOpen] = useState<number | null>(null);
  const [isMe][setIsMe] = useState(false);
  const [editing][setEditing] = useState(false);
  const [bio][setBio] = useState("");

  useEffect(() => {
    if (!username) return;
    supabase.from("videos").select("*").eq("username", username).then(({ data }) => setVideos(data as any));

    supabase.auth.getUser().then(({ data }) => {
      const myUsername = data.user?.user_metadata?.username || data.user?.email?.split("@")[0];
      if (myUsername?.toLowerCase() === username.toLowerCase()) setIsMe(true);
      else if (data.user) setIsMe(true); // allow logged in user to edit for now
    });

    supabase.from("profiles").select("bio").eq("username", username).single().then(({ data }) => {
      if (data) setBio(data.bio || "");
    });
  }, [username]);

  const saveProfile = async () => {
    await supabase.from("profiles").upsert({ username, bio });
    setEditing(false);
  };

  const totalLikes = (videos?? []).reduce((a: any, v: any) => a + (v.likes_count || 0), 0);

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>

        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-4xl uppercase text-primary-foreground">
            {username?.[0]}
          </div>
          <h1 className="text-2xl">@{username}</h1>

          {editing? (
            <div className="w-full max-w-sm space-y-2">
              <textarea value={bio} onChange={e => setBio(e.target.value)} placeholder="Your bio..." className="w-full rounded-md border bg-background p-2 text-sm" rows={3} />
              <Button onClick={saveProfile} size="sm" className="w-full"><Save className="mr-2 h-4 w-4"/> Save</Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground max-w-sm">{bio || "No bio yet."}</p>
          )}

          <div className="flex gap-8 text-sm">
            <span><b>{videos?.length?? "-"}</b> videos</span>
            <span><b>{formatCount(totalLikes)}</b> likes</span>
          </div>

          {!editing && (
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Edit3 className="mr-2 h-4 w-4"/> Edit profile
            </Button>
          )}
        </div>

        {videos === null && <p className="py-20 text-center text-muted-foreground">Loading...</p>}
        {videos?.length === 0 && <p className="py-20 text-center text-muted-foreground">No videos yet.</p>}

        <div className="grid grid-cols-3 gap-1">
          {videos?.map((v, i) => (
            <button key={v.id} onClick={() => setOpen(i)} className="relative aspect-[9/16] overflow-hidden rounded-md bg-zinc-800">
              <video src={`${v.video_url}#t=0.5`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
              <span className="absolute bottom-1 left-2 text-xs font-bold text-white">{formatCount(v.likes_count)} likes</span>
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
                <video src={v.video_url} className="h-full w-full object-cover" controls loop playsInline />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
