import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";

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

  const load = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const cleanName = username.replace("@", "");
    const myName = (user?.user_metadata as any)?.username || user?.email?.split("@")[0] || "";
    setIsMe(cleanName.toLowerCase() === myName.toLowerCase().replace("@", ""));

    const { data: prof } = await supabase.from("profiles").select("*").ilike("username", `%${cleanName}%`).maybeSingle();
    if (prof) {
      setProfile(prof);
      setBio(prof.bio || "");
      setDisplayName(prof.display_name || prof.username || "");
      setAvatar(prof.avatar_url || "");
    } else {
      setProfile({ username: cleanName, display_name: cleanName });
      setDisplayName(cleanName);
    }

    const { data: vids } = await supabase
     .from("videos")
     .select("*")
     .or(`username.eq.${cleanName},username.eq.@${cleanName},username.ilike.%${cleanName}%`)
     .order("created_at", { ascending: false });

    if (vids) setVideos(vids);
    setLoading(false);
  };

  useEffect(() => { load(); }, [username]);

  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const updates = { id: user.id, username: username.replace("@", ""), display_name: displayName, bio, avatar_url: avatar, updated_at: new Date().toISOString() };
    const { error } = await supabase.from("profiles").upsert(updates, { onConflict: 'id' });
    if (!error) { setProfile({...profile,...updates }); setEditing(false); alert("Saved!"); }
    else alert("Error: " + error.message);
  };

  const deleteVideo = async (id: string) => {
    if (!confirm("Delete this video forever?")) return;

    const { error } = await supabase.from("videos").delete().eq("id", id);

    if (!error) {
      setVideos(videos.filter(v => v.id!== id));
      alert("Deleted");
    } else {
      // If you get "policy" error, run the SQL below
      alert("Can't delete: " + error.message + "\nRun the SQL I gave you in Supabase.");
    }
  };

  if (loading) return <div className="p-10 text-white bg-black min-h-screen">Loading...</div>;

  return (
    <div className="min-h-screen bg-black text-white max-w-2xl mx-auto pb-20">
      <div className="flex flex-col items-center gap-3 pt-10 px-6">
        <img src={avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`} className="w-28 h-28 rounded-full object-cover border-2 border-white" />
        {!editing? (
          <>
            <h1 className="text-2xl font-bold">@{profile?.username || username.replace("@","")}</h1>
            <h2 className="text-md opacity-80">{profile?.display_name}</h2>
            <p className="text-center opacity-60 text-sm max-w-">{profile?.bio || "No bio yet"}</p>
            {isMe && <Button onClick={() => setEditing(true)} className="mt-4 w-full max-w-xs">Edit Profile</Button>}
          </>
        ) : (
          <div className="w-full max-w-xs space-y-4 mt-2">
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Display Name" className="bg-zinc-900 border-zinc-800" />
            <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="Avatar URL" className="bg-zinc-900 border-zinc-800" />
            <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" className="bg-zinc-900 border-zinc-800" />
            <div className="flex gap-2"><Button onClick={save} className="flex-1">Save</Button><Button variant="outline" onClick={() => setEditing(false)} className="flex-1">Cancel</Button></div>
          </div>
        )}
      </div>

      <div className="mt-10 border-t border-zinc-800 pt-6 px-2">
        <h3 className="text-center opacity-50 mb-4">{videos.length} videos {isMe && "- tap trash to delete"}</h3>
        <div className="grid grid-cols-3 gap-1">
          {videos.map((video) => (
            <div key={video.id} className="aspect-[9/16] bg-zinc-900 relative overflow-hidden group">
              <Link to={`/v/${video.id}`} className="w-full h-full block">
                <video src={video.video_url} className="w-full h-full object-cover" muted playsInline />
                <div className="absolute bottom-1 left-1 text-xs bg-black/60 px-1 rounded">▶ {video.views || 0}</div>
              </Link>
              {isMe && (
                <button
                  onClick={() => deleteVideo(video.id)}
                  className="absolute top-1 right-1 bg-red-600 p-1.5 rounded-full"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
