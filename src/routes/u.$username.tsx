import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ArrowLeft, Edit3, Save } from "lucide-react";

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function Profile() {
  const { username } = Route.useParams();
  const [isMe][setIsMe] = useState(false);
  const [editing][setEditing] = useState(false);
  const [bio][setBio] = useState("");
  const [newUsername][setNewUsername] = useState(username);
  const [myId][setMyId] = useState<string | null>(null);
  const [videos][setVideos] = useState<any[] | null>(null);

  useEffect(() => {
    setNewUsername(username);
    supabase.from("videos").select("*").eq("username", username).order("created_at", { ascending: false }).then(({ data }) => setVideos(data || []));
    supabase.from("profiles").select("bio").eq("username", username).maybeSingle().then(({ data }) => { if (data?.bio) setBio(data.bio); });
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setMyId(data.user.id);
      const { data: p } = await supabase.from("profiles").select("username").eq("user_id", data.user.id).maybeSingle();
      const current = p?.username || (data.user.user_metadata as any)?.username || data.user.email?.split("@")[0];
      if (current === username) setIsMe(true);
    });
  }, [username]);

  const saveUsername = async () => {
    if (!myId) return alert("Not logged in");
    const clean = newUsername.toLowerCase().trim();
    if (!clean) return alert("Username empty");
    if (clean!== username) {
      const { data: exists } = await supabase.from("profiles").select("username").eq("username", clean).maybeSingle();
      if (exists) return alert("That username is taken");
    }
    const { error } = await supabase.from("profiles").upsert({ user_id: myId, username: clean, bio }, { onConflict: "user_id" });
    if (error) return alert(error.message);
    await supabase.auth.updateUser({ data: { username: clean } });
    await supabase.from("videos").update({ username: clean }).eq("user_id", myId);
    window.location.href = `/u/${clean}`;
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Home</Link>
        <div className="flex flex-col items-center gap-4 py-10">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-4xl uppercase text-primary-foreground">{username?.[0]}</div>
          <h1 className="text-3xl">@{username}</h1>
          {!editing? (
            <>
              <p className="text-sm text-muted-foreground text-center max-w-sm">{bio || "No bio"}</p>
              <p className="text-xs text-muted-foreground">{videos?.length?? 0} videos</p>
              {isMe && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Edit3 className="mr-2 h-4 w-4" />Edit profile</Button>}
            </>
          ) : (
            <div className="w-full max-w-sm space-y-3">
              <div>
                <label className="text-xs">Username</label>
                <Input value={newUsername} onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} placeholder="new username" />
              </div>
              <div>
                <label className="text-xs">Bio</label>
                <Textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Your bio" rows={3} />
              </div>
              <Button onClick={saveUsername} className="w-full"><Save className="mr-2 h-4 w-4" />Save</Button>
              <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {videos?.map((v: any) => (
            <div key={v.id} className="aspect-[9/16] bg-zinc-900 rounded overflow-hidden">
              <video src={v.video_url} className="w-full h-full object-cover" muted />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
