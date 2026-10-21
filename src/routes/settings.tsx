import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, LogOut, Pencil, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import ThemePicker from "@/components/ThemePicker"
export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — Coolerup" },
      { name: "description", content: "Manage your Coolerup profile and account settings." },
      { property: "og:title", content: "Settings — Coolerup" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Settings,
});

function Settings() {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);

  // Username edit
  const [newHandle, setNewHandle] = useState("");
  const [updatingHandle, setUpdatingHandle] = useState(false);

  // Blocked users
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockTarget, setBlockTarget] = useState("");
  const [blocking, setBlocking] = useState(false);

  // Notifications (simple toggle stored in localStorage as prototype)
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("settings:notifications") !== "false";
    } catch (e) {
      return true;
    }
  });

  // Theme
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("settings:theme") || "system";
    } catch (e) {
      return "system";
    }
  });

  useEffect(() => {
    setNewHandle(auth.handle ?? "");
  }, [auth.handle]);

  useEffect(() => {
    if (!auth.user) return;
    // load blocked users
    supabase
      .from("blocked_users")
      .select("blocked_username")
      .eq("blocker_id", auth.user.id)
      .then(({ data, error }) => {
        if (error) return;
        setBlocked((data ?? []).map((r: any) => r.blocked_username));
      });
  }, [auth.user?.id]);

  const saveHandle = async () => {
    if (!auth.user) return;
    const handle = (newHandle || "").trim().replace(/^@/, "").toLowerCase();
    if (!handle.match(/^[a-z0-9._]{1,40}$/)) {
      toast.error("Handles may contain only lowercase letters, numbers, dots, and underscores (1-40 chars)");
      return;
    }
    if (handle === auth.handle) {
      toast("No change");
      return;
    }
    setUpdatingHandle(true);
    try {
      const { error } = await supabase.from("profiles").update({ handle }).eq("id", auth.user.id);
      if (error) {
        if ((error as any).code === "23505") {
          toast.error(`@${handle} is already taken`);
        } else {
          toast.error(error.message || "Couldn't update handle");
        }
        return;
      }
      toast.success("Handle updated");
    } finally {
      setUpdatingHandle(false);
    }
  };

  const doBlock = async (username: string) => {
    if (!auth.user || !username) return;
    setBlocking(true);
    const blockedUsername = username.trim().replace(/^@/, "").toLowerCase();
    try {
      // Check user exists
      const { data: profile } = await supabase.from("profiles").select("id, handle").eq("handle", blockedUsername).maybeSingle();
      if (!profile) {
        toast.error(`@${blockedUsername} not found`);
        return;
      }
      const { error } = await supabase.from("blocked_users").insert({ blocker_id: auth.user.id, blocker_username: auth.handle, blocked_username: blockedUsername });
      if (error) {
        toast.error(error.message || "Couldn't block user");
        return;
      }
      setBlocked((b) => [...b, blockedUsername]);
      setBlockTarget("");
      toast.success(`@${blockedUsername} blocked`);
    } finally {
      setBlocking(false);
    }
  };

  const doUnblock = async (username: string) => {
    if (!auth.user) return;
    const uname = username.trim().replace(/^@/, "").toLowerCase();
    const { error } = await supabase.from("blocked_users").delete().eq("blocker_id", auth.user.id).eq("blocked_username", uname);
    if (error) {
      toast.error("Couldn't unblock");
      return;
    }
    setBlocked((b) => b.filter((x) => x !== uname));
    toast.success(`@${uname} unblocked`);
  };

  const toggleNotifications = (v: boolean) => {
    setNotificationsEnabled(v);
    try {
      localStorage.setItem("settings:notifications", v ? "true" : "false");
    } catch {}
    toast.success(v ? "Notifications enabled" : "Notifications disabled");
  };

const changeTheme = (t: string) => {
  setTheme(t);
  try {
    localStorage.setItem("settings:theme", t);
  } catch {}

  // reset primary first
  if (t === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else if (t === "light") {
    document.documentElement.setAttribute("data-theme", "blue");
  } else if (t === "blue") {
    document.documentElement.setAttribute("data-theme", "blue");
    document.documentElement.style.setProperty("--primary", "221 83% 53%");
    document.documentElement.style.setProperty("--ring", "221 83% 53%");
  } else if (t === "purple") {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.style.setProperty("--primary", "271 81% 56%");
    document.documentElement.style.setProperty("--ring", "271 81% 56%");
  } else if (t === "pink") {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.style.setProperty("--primary", "330 81% 60%");
    document.documentElement.style.setProperty("--ring", "330 81% 60%");
  } else if (t === "green") {
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.style.setProperty("--primary", "142 76% 36%");
    document.documentElement.style.setProperty("--ring", "142 76% 36%");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  
  toast.success(`Theme: ${t}`);
};

  if (auth.ready && !auth.user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="font-display text-2xl">Settings</p>
        <p className="max-w-sm text-muted-foreground">Sign in to manage your profile, username, and account preferences.</p>
        <Button onClick={auth.signIn}>Sign in</Button>
        <Link to="/" className="text-sm text-muted-foreground">Back to home</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-10 pt-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/" aria-label="Back to home" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl">Settings</h1>
      </div>

      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-4">
          {auth.avatar ? (
            <img src={auth.avatar} alt={auth.name ?? "Profile avatar"} className="h-14 w-14 rounded-full object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary font-display text-xl uppercase text-primary-foreground">
              {auth.name?.[0] ?? "U"}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-lg font-bold">{auth.name ?? "Your profile"}</p>
            <p className="text-sm text-muted-foreground">@{auth.handle ?? "your-handle"}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">
          <Button variant="outline" className="w-full justify-start" onClick={() => setEditing(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit profile
          </Button>

          {auth.handle && (
            <Link
              to="/u/$username"
              params={{ username: auth.handle }}
              className="flex w-full items-center justify-start rounded-md border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
            >
              <UserRound className="mr-2 h-4 w-4" />
              View profile
            </Link>
          )}

          <Button variant="outline" className="w-full justify-start" onClick={auth.signOut}>
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </Button>
        </div>
      </div>

      {/* Username editor */}
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">Username</h2>
        <p className="mt-1 text-sm text-muted-foreground">Your handle is how others find you. It must be unique.</p>
        <div className="mt-3 flex gap-2">
          <input value={newHandle} onChange={(e) => setNewHandle(e.target.value)} className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
          <Button onClick={saveHandle} disabled={updatingHandle}>{updatingHandle ? "Saving..." : "Save"}</Button>
        </div>
      </div>

      {/* Privacy / Blocked users */}
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">Privacy</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manage blocked users.</p>
        <div className="mt-3 flex gap-2">
          <input value={blockTarget} onChange={(e) => setBlockTarget(e.target.value)} placeholder="@username to block" className="min-w-0 flex-1 rounded-md border bg-background px-3 py-2 text-sm" />
          <Button onClick={() => doBlock(blockTarget)} disabled={blocking}>{blocking ? "Blocking..." : "Block"}</Button>
        </div>
        <div className="mt-3 space-y-2">
          {blocked.length === 0 ? <p className="text-sm text-muted-foreground">No blocked users</p> : blocked.map((b) => (
            <div key={b} className="flex items-center justify-between rounded-md border bg-background px-3 py-2">
              <div className="text-sm">@{b}</div>
              <button onClick={() => doUnblock(b)} className="text-sm text-primary">Unblock</button>
            </div>
          ))}
        </div>
      </div>

      {/* Notifications */}
      <div className="rounded-2xl border bg-card p-4">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-primary" />
          <h2 className="font-semibold">Notifications</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">Control basic notification preferences (prototype).</p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => toggleNotifications(true)} className={`rounded-md px-3 py-2 ${notificationsEnabled ? "bg-primary text-primary-foreground" : "border bg-background"}`}>
            Enable
          </button>
          <button onClick={() => toggleNotifications(false)} className={`rounded-md px-3 py-2 ${!notificationsEnabled ? "bg-primary text-primary-foreground" : "border bg-background"}`}>
            Disable
          </button>
        </div>
      </div>

   {/* Appearance */}
<div className="rounded-2xl border bg-card p-4">
  <h2 className="font-semibold">Appearance</h2>
  <p className="mt-1 text-sm text-muted-foreground">Choose an app theme.</p>
  <div className="mt-3 flex flex-wrap gap-2">
    <button onClick={() => changeTheme("light")} className={`rounded-md px-3 py-2 ${theme === "light" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>Light</button>
    <button onClick={() => changeTheme("dark")} className={`rounded-md px-3 py-2 ${theme === "dark" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>Dark</button>
    <button onClick={() => changeTheme("system")} className={`rounded-md px-3 py-2 ${theme === "system" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>System</button>
    <button onClick={() => changeTheme("blue")} className={`rounded-md px-3 py-2 ${theme === "blue" ? "bg-blue-600 text-white" : "border bg-background"}`}>Blue</button>
    <button onClick={() => changeTheme("purple")} className={`rounded-md px-3 py-2 ${theme === "purple" ? "bg-purple-600 text-white" : "border bg-background"}`}>Purple</button>
    <button onClick={() => changeTheme("pink")} className={`rounded-md px-3 py-2 ${theme === "pink" ? "bg-pink-500 text-white" : "border bg-background"}`}>Pink</button>
    <button onClick={() => changeTheme("green")} className={`rounded-md px-3 py-2 ${theme === "green" ? "bg-green-600 text-white" : "border bg-background"}`}>Green</button>
  </div>
</div> 

      {auth.user && <EditProfileDialog open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
