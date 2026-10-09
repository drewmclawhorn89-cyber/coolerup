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

  useEffect(() => {
    setNewUsername(username);
    supabase.from("profiles").select("bio").eq("username", username).maybeSingle().then(({ data }) => {
      if (data?.bio) setBio(data.bio);
    });
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      setMyId(data.user.id);
      const { data: p } = await supabase.from("profiles").select("username").eq("user_id", data.user.id).maybeSingle();
      const current = p?.username || data.user.user_metadata?.username || data.user.email?.split("@")[0];
      if (current === username) setIsMe(true);
    });
  }, [username]);

  const saveUsername = async () => {
    if (!myId) return alert("Not logged in");
    if (!newUsername) return alert("Username can't be empty");
    if (newUsername === username) {
      setEditing(false);
      return;
    }

    // Check if taken
    const { data: exists } = await supabase.from("profiles").select("username").eq("username", newUsername).maybeSingle();
    if (exists) return alert("That username is already taken");

    // Update profile table
    const { error } = await supabase.from("profiles").upsert(
      { user_id: myId, username: newUsername, bio },
      { onConflict: "user_id" }
    );
    if (error) return alert(error.message);

    // Update auth
    await supabase.auth.updateUser({ data: { username: newUsername } });

    // Update your videos so they show under new name
    await supabase.from("videos").update({ username: newUsername }).eq("user_id", myId);

    window.location.href = `/u/${newUsername}`;
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
                  <Edit3 className="mr-2 h-4 w-4" /> Edit username
                </Button>
              )}
            </>
          ) : (
            <div className="w-full max-w-sm space-y-4">
              <div>
                <label className="text-sm font-medium">New Username</label>
                <input
                  value={newUsername}
                  onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  className="w-full mt-1 rounded-md border bg-background p-3"
                  placeholder="new username"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Bio</label>
                <textarea
                  value={bio}
                  onChange={(e) => setBio(e.target.value)}
                  className="w-full mt-1 rounded-md border bg-background p-3"
                  rows={3}
                />
              </div>
              <Button onClick={saveUsername} className="w-full">
                <Save className="mr-2 h-4 w-4" /> Save
              </Button>
              <Button variant="ghost" className="w-full" onClick={() => setEditing(false)}>Cancel</Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
