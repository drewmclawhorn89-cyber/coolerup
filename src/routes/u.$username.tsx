import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Edit3, Save } from "lucide-react";

export const Route = createFileRoute("/u/$username")({
  component: Profile,
});

function Profile() {
  const { username } = Route.useParams();
  const [isMe, setIsMe] = useState(false);
  const [editing, setEditing] = useState(false);
  const [bio, setBio] = useState("");
  const [newUsername, setNewUsername] = useState(username);
  const [myId, setMyId] = useState(null as string | null);

  useEffect(() => {
    setNewUsername(username);
    supabase.from("profiles").select("bio").eq("username", username).maybeSingle().then(({ data }) => {
      if (data?.bio) setBio(data.bio);
    });
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
    if (!clean) return alert("Empty");
    if (clean!== username) {
      const { data: exists } = await supabase.from("profiles").select("username").eq("username", clean).maybeSingle();
      if (exists) return alert("Taken");
    }
    const { error } = await supabase.from("profiles").upsert({ user_id: myId, username: clean, bio }, { onConflict: "user_id" });
    if (error) return alert(error.message);
    await supabase.auth.updateUser({ data: { username: clean } });
    await supabase.from("videos").update({ username: clean }).eq("user_id", myId);
    window.location.href = "/u/" + clean;
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" /> Home
        </Link>
        <div className="flex flex-col items-center gap-8 py-12">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-4xl uppercase text-primary-foreground">
            {username?.[0]}
          </div>
          {!editing? (
            <>
              <h1 className="text-3xl">@{username}</h1>
              <p className="text-muted-foreground text-sm">{bio || "No bio"}</p>
              {isMe && (
                <Button variant="outline" onClick={() => setEditing(true)}>
                  <Edit3 className="mr-2 h-4 w-4" /> Edit profile
                </Button>
              )}
            </>
          ) : (
            <div className="w-full max-w-sm space-y-4">
              <input value={newUsername} onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} className="w-full rounded-md border bg-background p-3" placeholder="new username" />
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-md border bg-background p-3" rows={3} placeholder="Bio" />
              <Button onClick={saveUsername} className="w-full"><Save className="mr-2 h-4 w-4" /> Save</Button>
              <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
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
  const [profileUserId][setProfileUserId] = useState<string | null>(null);

  useEffect(() => {
    setNewUsername(username);
    // get profile that this page is for
    supabase.from("profiles").select("user_id, bio").eq("username", username).maybeSingle().then(({ data }) => {
      if (data) {
        setProfileUserId(data.user_id);
        if (data.bio) setBio(data.bio);
      }
    });
    // get who I am
    supabase.auth.getUser().then(({ data }) => {
      if (!data.user) return;
      setMyId(data.user.id);
      // if page user_id === my id, it's me. Also fallback to metadata
      supabase.from("profiles").select("username").eq("user_id", data.user.id).maybeSingle().then(({ data: myProfile }) => {
        const myUsername = myProfile?.username || (data.user?.user_metadata as any)?.username || data.user?.email?.split("@")[0];
        if (myUsername === username) setIsMe(true);
      });
    });
  }, [username]);

  // second check: if we know both ids, compare ids directly (most reliable)
  useEffect(() => {
    if (myId && profileUserId && myId === profileUserId) setIsMe(true);
    // if profile doesn't exist yet but you're viewing your own URL from metadata, still allow edit
    if (myId &&!profileUserId) setIsMe(true);
  }, [myId][profileUserId]);

  const save = async () => {
    if (!myId) return alert("Not logged in");
    const clean = newUsername.toLowerCase().trim();
    if (!clean) return alert("Empty");
    if (clean!== username) {
      const { data: exists } = await supabase.from("profiles").select("username").eq("username", clean).maybeSingle();
      if (exists) return alert("That username is taken");
    }
    const { error } = await supabase.from("profiles").upsert({ user_id: myId, username: clean, bio }, { onConflict: "user_id" });
    if (error) return alert(error.message);
    await supabase.auth.updateUser({ data: { username: clean } });
    await supabase.from("videos").update({ username: clean }).eq("user_id", myId);
    window.location.href = "/u/" + clean;
  };

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-4xl px-4 pt-4">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Home</Link>
        <div className="flex flex-col items-center gap-6 py-12">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-primary text-4xl uppercase text-primary-foreground">{username?.[0]}</div>
          {!editing? (
            <>
              <h1 className="text-3xl">@{username}</h1>
              <p className="text-muted-foreground text-sm">{bio || "No bio"}</p>
              {isMe && <Button variant="outline" onClick={() => setEditing(true)}><Edit3 className="mr-2 h-4 w-4" /> Edit profile</Button>}
            </>
          ) : (
            <div className="w-full max-w-sm space-y-3">
              <input value={newUsername} onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))} className="w-full rounded-md border bg-background p-3" placeholder="new username" />
              <textarea value={bio} onChange={(e) => setBio(e.target.value)} className="w-full rounded-md border bg-background p-3" rows={3} placeholder="Your bio" />
              <Button onClick={save} className="w-full"><Save className="mr-2 h-4 w-4" /> Save</Button>
              <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
