import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/u/$username")({
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = Route.useParams();
  const [profile][setProfile] = useState<any>(null);
  const [videos][setVideos] = useState<any[]>([]);
  const [isMe][setIsMe] = useState(false);
  const [editing][setEditing] = useState(false);
  const [bio][setBio] = useState("");
  const [displayName][setDisplayName] = useState("");
  const [avatar][setAvatar] = useState("");
  const [loading][setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const cleanName = username.replace("@", "");
      const myName = (user?.user_metadata as any)?.username || user?.email?.split("@")[0] || "";

      setIsMe(cleanName.toLowerCase() === myName.toLowerCase().replace("@", ""));

      // profile
      const { data: prof } = await supabase.from("profiles").select("*").ilike("username", `%${cleanName}%`).maybeSingle();

      if (prof) {
        setProfile(prof);
        setBio(prof.bio || "");
        setDisplayName(prof.display_name || prof.username || "");
        setAvatar(prof.avatar_url || "");
      } else {
        setProfile({ username: cleanName, display_name: cleanName, bio: "", avatar_url: "" });
        setDisplayName(cleanName);
      }

      // VIDEOS - this is what shows your videos on profile
      const { data: vids } = await supabase
       .from("videos")
       .select("*")
       .or(`username.eq.${cleanName},username.eq.@${cleanName},username.ilike.%${cleanName}%`)
       .order("created_at", { ascending: false });

      if (vids) setVideos(vids);

      setLoading(false);
    };
    load();
  }, [username]);

  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const updates = {
      id: user.id,
      username: username.replace("@", ""),
      display_name: displayName,
      bio: bio,
      avatar_url: avatar,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("profiles").upsert(updates, { onConflict: 'id' });

    if (!error) {
      setProfile({...profile,...updates });
      setEditing(false);
      alert("Saved!");
    } else {
      alert("Error: " + error.message);
    }
  };

  if (loading) return <div className="p-10 text-white bg-black min-h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-black text-white max-w-2xl mx-auto">
      {/* HEADER */}
      <div className="flex flex-col items-center gap-3 pt-10 px-6">
        <img
          src={avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`}
          className="w-28 h-28 rounded-full object-cover border-2 border-white"
        />

        {!editing? (
          <>
            <h1 className="text-2xl font-bold">@{profile?.username || username.replace("@","")}</h1>
            <h2 className="text-md opacity-80">{profile?.display_name}</h2>
            <p className="text-center opacity-60 text-sm max-w-">{profile?.bio || "No bio yet"}</p>

            {isMe && (
              <Button onClick={() => setEditing(true)} className="mt-4 w-full max-w-xs">
                Edit Profile
              </Button>
            )}
          </>
        ) : (
          <div className="w-full max-w-xs space-y-4 mt-2">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display Name" className="bg-zinc-900 border-zinc-800" />
            <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="Avatar URL https://..." className="bg-zinc-900 border-zinc-800" />
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" className="bg-zinc-900 border-zinc-800" />
            <div className="flex gap-2">
              <Button onClick={save} className="flex-1">Save</Button>
              <Button variant="outline" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
            </div>
          </div>
        )}
      </div>

      {/* VIDEO GRID - THIS SHOWS YOUR VIDEOS */}
      <div className="mt-10 border-t border-zinc-800 pt-6 px-2">
        <h3 className="text-center opacity-50 mb-4">{videos.length} videos</h3>

        {videos.length === 0? (
          <p className="text-center opacity-30 mt-10">No videos yet</p>
        ) : (
          <div className="grid grid-cols-3 gap-1">
            {videos.map((video) => (
              <Link key={video.id} to={`/v/${video.id}`} className="aspect-[9/16] bg-zinc-900 relative overflow-hidden">
                <video
                  src={video.video_url}
                  className="w-full h-full object-cover"
                  muted
                  playsInline
                />
                <div className="absolute bottom-1 left-1 text-xs bg-black/60 px-1 rounded flex items-center gap-1">
                  ▶ {video.views || 0}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
