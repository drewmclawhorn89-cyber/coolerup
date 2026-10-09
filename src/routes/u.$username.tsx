import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/u/$username")({
  component: ProfilePage,
});

function ProfilePage() {
  const { username } = Route.useParams();
  const [profile, setProfile] = useState<any>(null);
  const [isMe, setIsMe] = useState(false);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [avatar, setAvatar] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const cleanName = username.replace("@", "");
      const myName = (user?.user_metadata as any)?.username || user?.email?.split("@")[0] || "";

      setIsMe(cleanName.toLowerCase() === myName.toLowerCase().replace("@", ""));

      const { data } = await supabase.from("profiles").select("*").ilike("username", `%${cleanName}%`).maybeSingle();

      if (data) {
        setProfile(data);
        setBio(data.bio || "");
        setDisplayName(data.display_name || data.username || "");
        setAvatar(data.avatar_url || "");
      } else {
        // fallback if profile doesn't exist
        setProfile({ username: cleanName, display_name: cleanName, bio: "", avatar_url: "" });
        setDisplayName(cleanName);
      }
      setLoading(false);
    };
    load();
  }, [username]);

  const save = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const updates = {
      username: username.replace("@", ""),
      display_name: displayName,
      bio: bio,
      avatar_url: avatar,
      updated_at: new Date().toISOString(),
      id: user.id
    };

    const { error } = await supabase.from("profiles").upsert(updates).select().single();

    if (!error) {
      setProfile({...profile,...updates });
      setEditing(false);
      alert("Profile saved!");
    } else {
      alert("Error: " + error.message);
    }
  };

  if (loading) return <div className="p-10">Loading...</div>;

  return (
    <div className="min-h-screen bg-black text-white p-6 max-w-lg mx-auto">
      <div className="flex flex-col items-center gap-4 mt-10">
        <img
          src={avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${username}`}
          className="w-28 h-28 rounded-full object-cover border-2 border-white"
        />

        {!editing? (
          <>
            <h1 className="text-2xl font-bold">@{profile?.username || username}</h1>
            <h2 className="text-lg opacity-80">{profile?.display_name}</h2>
            <p className="text-center opacity-60 mt-2">{profile?.bio || "No bio yet"}</p>

            {isMe && (
              <Button onClick={() => setEditing(true)} className="mt-6 w-full">
                Edit Profile
              </Button>
            )}
          </>
        ) : (
          <>
            <h1 className="text-xl font-bold">Edit Profile</h1>

            <div className="w-full space-y-4 mt-4">
              <div>
                <label className="text-sm opacity-60">Display Name</label>
                <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Drew" className="bg-zinc-900 border-zinc-800" />
              </div>

              <div>
                <label className="text-sm opacity-60">Avatar URL</label>
                <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} placeholder="https://..." className="bg-zinc-900 border-zinc-800" />
                <p className="text-xs opacity-40 mt-1">Paste an image link from imgur or upload to Supabase storage later</p>
              </div>

              <div>
                <label className="text-sm opacity-60">Bio</label>
                <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Your bio..." className="bg-zinc-900 border-zinc-800" />
              </div>

              <div className="flex gap-2">
                <Button onClick={save} className="flex-1">Save</Button>
                <Button variant="outline" onClick={() => setEditing(false)} className="flex-1">Cancel</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
