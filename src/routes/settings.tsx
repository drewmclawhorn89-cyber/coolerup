import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Download, LogOut, Pencil, ShieldCheck, UserRound, Eye, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { formatBytes, getSaved, listSaved, onOfflineChange, removeOffline } from "@/lib/offline";

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

  // Offline panel state
  const [showOffline, setShowOffline] = useState(false);
  const [offlineItems, setOfflineItems] = useState<{ id: string; video: any; size: number }[] | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    setNewHandle(auth.handle ?? "");
  }, [auth.handle]);

  useEffect(() => {
    if (!auth.user) return;
    supabase
      .from("blocked_users")
      .select("blocked_username")
      .eq("blocker_id", auth.user.id)
      .then(({ data, error }) => {
        if (error) return;
        setBlocked((data ?? []).map((r: any) => r.blocked_username));
      });
  }, [auth.user?.id]);

  useEffect(() => {
    if (!showOffline) return;
    let mounted = true;
    const refresh = async () => {
      try {
        const saved = await listSaved();
        if (!mounted) return;
        setOfflineItems(saved.map((s) => ({ id: s.id, video: s.video, size: s.size })));
      } catch (e) {
        console.error(e);
        if (!mounted) return;
        setOfflineItems([]);
      }
    };
    refresh();
    const off = onOfflineChange(refresh);
    return () => {
      mounted = false;
      off();
    };
  }, [showOffline]);

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
    if (t === "dark") document.documentElement.setAttribute("data-theme", "dark");
    else if (t === "light") document.documentElement.setAttribute("data-theme", "light");
    else document.documentElement.removeAttribute("data-theme");
    toast.success(`Theme: ${t}`);
  };

  // Offline handlers used inside settings panel
  const handleView = async (id: string) => {
    try {
      const saved = await getSaved(id);
      if (!saved?.blob) {
        toast.error("Couldn't find saved video");
        return;
      }
      const url = URL.createObjectURL(saved.blob);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't open saved video");
    }
  };

  const handleDownload = async (id: string) => {
    try {
      const saved = await getSaved(id);
      if (!saved?.blob) {
        toast.error("Couldn't find saved video");
        return;
      }
      const url = URL.createObjectURL(saved.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coolerup-${id}.mp4`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success("Download started");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't download saved video");
    }
  };

  const handleRemove = async (id: string) => {
    setRemovingId(id);
    try {
      await removeOffline(id);
      setOfflineItems((cur) => (cur ?? []).filter((item) => item.id !== id));
      toast.success("Removed from offline");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't remove saved video");
    } finally {
      setRemovingId(null);
    }
  };

  if (auth.ready && !auth.user) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-background p-6 text-center">
        <p className="font-display text-2xl">Settings</p>
        <p className="max-w-sm text-muted-foreground">Sign in to manage your profile, username, and account preferences.</p>
        <Button onClick={auth.signIn}>Sign in with Google</Button>
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

      {/* Content & Display */}
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">Content & Display</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manage content you store locally and how it displays.</p>

        <div className="mt-3 flex items-center justify-between rounded-md border bg-background px-3 py-2 text-left">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-zinc-900 p-2">
              <Download className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-medium">Offline videos</div>
              <div className="text-xs text-muted-foreground">Manage videos saved for offline viewing</div>
            </div>
          </div>
          <div>
            <Button variant="ghost" onClick={() => setShowOffline(true)}>Open</Button>
          </div>
        </div>

        {showOffline && (
          <div className="mt-4 rounded-md border bg-background p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="ghost" size="icon" onClick={() => setShowOffline(false)}>
                  <ArrowLeft />
                </Button>
                <div className="text-sm font-medium">Offline videos</div>
              </div>
            </div>

            <div className="mt-3">
              {!offlineItems ? (
                <div className="text-sm text-muted-foreground">Loading saved videos…</div>
              ) : offlineItems.length === 0 ? (
                <div className="text-sm text-muted-foreground">No saved videos</div>
              ) : (
                <div className="space-y-3">
                  {offlineItems.map((item) => (
                    <div key={item.id} className="flex items-center justify-between gap-3 rounded-md border bg-card px-3 py-2">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="h-12 w-16 overflow-hidden rounded bg-zinc-800">
                          {item.video?.poster_url ? <img src={item.video.poster_url} alt="" className="h-full w-full object-cover" /> : null}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{item.video?.caption || `@${item.video?.username}`}</div>
                          <div className="text-xs text-muted-foreground">{formatBytes(item.size)}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleView(item.id)}>
                          <Eye className="mr-1 h-4 w-4" />
                          View
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => handleDownload(item.id)}>
                          <Download className="mr-1 h-4 w-4" />
                          Download
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => handleRemove(item.id)} disabled={removingId === item.id}>
                          <Trash2 className="mr-1 h-4 w-4" />
                          {removingId === item.id ? "Removing..." : "Remove"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Appearance */}
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">Choose an app theme.</p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => changeTheme("light")} className={`rounded-md px-3 py-2 ${theme === "light" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>Light</button>
          <button onClick={() => changeTheme("dark")} className={`rounded-md px-3 py-2 ${theme === "dark" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>Dark</button>
          <button onClick={() => changeTheme("system")} className={`rounded-md px-3 py-2 ${theme === "system" ? "bg-primary text-primary-foreground" : "border bg-background"}`}>System</button>
        </div>
      </div>

      {auth.user && <EditProfileDialog open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
