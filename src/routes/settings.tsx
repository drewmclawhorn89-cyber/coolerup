import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, CreditCard, Lock, LogOut, Pencil, ShieldCheck, UserRound } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { EditProfileDialog } from "@/components/EditProfileDialog";
import { refreshProfile, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { writePref } from "@/lib/prefs";
import { MoreSettings } from "@/components/MoreSettings";
import { hasOfflineAccess, offlinePlan, trialDaysLeft, useSubscription } from "@/lib/subscriptions";
import { ThemePicker } from "@/components/ThemePicker"
import {
  announcePushPref,
  disablePushSubscription,
  ensurePushSubscription,
  pushConfigured,
  pushDiagnostics,
  pushPermission,
  pushStatus,
  sendTestPush,
} from "@/lib/push-client"

// Subscriptions moved out of the top tab row and into Settings. Lazy-loaded so
// the payment sheet code isn't part of the settings bundle.
const SubscriptionsPanel = lazy(() =>
  import("@/components/SubscriptionsPanel").then((m) => ({ default: m.SubscriptionsPanel })),
);

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
  // Offline mode is a paid perk — re-read the plan whenever it changes.
  const subscription = useSubscription(auth.handle);
  const offlineUnlocked = hasOfflineAccess(auth.handle);
  const offlinePrice = offlinePlan().price;
  const [editing, setEditing] = useState(false);
  // Subscriptions used to be its own top tab; it now opens from inside Settings.
  const [showSubscriptions, setShowSubscriptions] = useState(false);
  const savePhone = () => {
    try {
      localStorage.setItem("settings:phone", phone);
      // If you use Supabase / Lovable Auth, this also saves to your account
      // so it won't delete anything - just adds phone to your profile
    } catch {}
    toast.success("Phone number saved");
  };
    const saveLinks = () => {
    try {
      localStorage.setItem("settings:tiktok", tiktokLink);
      localStorage.setItem("settings:instagram", instagramLink);
      localStorage.setItem("settings:youtube", youtubeLink);
    } catch {}
    toast.success("Links saved to profile");
  };
  // Username edit
  const [newHandle, setNewHandle] = useState("");
  const [updatingHandle, setUpdatingHandle] = useState(false);

  // Blocked users
  const [blocked, setBlocked] = useState<string[]>([]);
  const [blockTarget, setBlockTarget] = useState("");
  const [blocking, setBlocking] = useState(false);
  const [privateAccount, setPrivateAccount] = useState(false);
    const [phone, setPhone] = useState("");
    const [tiktokLink, setTiktokLink] = useState("");
  const [instagramLink, setInstagramLink] = useState("");
  const [youtubeLink, setYoutubeLink] = useState("");
const [offlineMode, setOfflineMode] = useState(false);
  // Notifications (simple toggle stored in localStorage as prototype)
  const [notificationsEnabled, setNotificationsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem("settings:notifications") !== "false";
    } catch (e) {
      return true;
    }
  });
  // Live push diagnostics so a misconfiguration is visible instead of silent.
  const [pushState, setPushState] = useState<{ configured: boolean; devices: number; source?: string } | null>(null);
  const [testingPush, setTestingPush] = useState(false);
  const [deviceHint, setDeviceHint] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<string | null>(null);
const [messagePrivacy, setMessagePrivacy] = useState(localStorage.getItem("messagePrivacy") || "everyone");
const [messageFilter, setMessageFilter] = useState(localStorage.getItem("messageFilter") || "all");
const [allowDM, setAllowDM] = useState(localStorage.getItem("allowDM") !== "false");
const [readReceipts, setReadReceipts] = useState(localStorage.getItem("readReceipts") !== "false");
  // Theme
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem("settings:theme") || "dark";
    } catch (e) {
      return "system";
    }
  });
useEffect(() => {
  try {
    const savedOffline = localStorage.getItem("settings:offline") === "true";
    // A subscription that lapsed must not leave offline mode switched on.
    // Wait for auth to resolve first: running this while `handle` is still null
    // would read "no subscription" and wipe a real subscriber's setting.
    if (auth.ready) {
      const allowed = savedOffline && hasOfflineAccess(auth.handle);
      setOfflineMode(allowed);
      if (savedOffline && !allowed) localStorage.setItem("settings:offline", "false");
    } else {
      setOfflineMode(savedOffline);
    }
          setPrivateAccount(localStorage.getItem("settings:private") === "true");
          setPhone(localStorage.getItem("settings:phone") || "");
         setTiktokLink(localStorage.getItem("settings:tiktok") || "");
      setInstagramLink(localStorage.getItem("settings:instagram") || "");
      setYoutubeLink(localStorage.getItem("settings:youtube") || ""); 
  } catch {}
}, [auth.ready, auth.handle]);

const toggleOffline = () => {
  const newVal = !offlineMode;

  // Turning it ON is a paid feature. Turning it OFF is always allowed so a
  // lapsed subscriber can still clean up.
  if (newVal && !offlineUnlocked) {
    toast.error(`Offline mode is part of Plus ($${offlinePrice.toFixed(2)}/mo)`);
    return;
  }

  setOfflineMode(newVal);
  try { localStorage.setItem("settings:offline", String(newVal)); } catch {}
  
  if (newVal) {
  
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }
  toast.success(`Offline mode: ${newVal ? "ON - videos will cache" : "OFF"}`);
};
  useEffect(() => {
    setNewHandle(auth.handle ?? "");
  }, [auth.handle]);

  useEffect(() => {
    if (!auth.user) return;
    let cancelled = false;
    pushStatus()
      .then((s) => { if (!cancelled) setPushState(s); })
      .catch(() => { if (!cancelled) setPushState({ configured: false, devices: 0, source: "none" }); });
    pushDiagnostics()
      .then((d) => { if (!cancelled) setDeviceHint(d.hint); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [auth.user?.id]);

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
      refreshProfile();
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

  const toggleNotifications = async (v: boolean) => {
    setNotificationsEnabled(v);
    try {
      localStorage.setItem("settings:notifications", v ? "true" : "false");
    } catch {}

    if (v) {
      if (pushPermission() === "unsupported") {
        toast.success("Notifications enabled in-app");
        announcePushPref(true);
        return;
      }
      if (!pushConfigured()) {
        toast.error("Out-of-app push isn't configured yet (missing VAPID key). In-app alerts only.");
        announcePushPref(true);
        return;
      }
      const ok = await ensurePushSubscription();
      if (ok) {
        toast.success("Notifications enabled — you'll get alerts even when the app is closed");
        pushStatus().then(setPushState).catch(() => undefined);
      } else if (pushPermission() === "denied") {
        toast.error("Notifications are blocked in your browser settings");
      } else {
        toast.error("Couldn't register this device for push. Try again.");
      }
    } else {
      await disablePushSubscription();
      toast.success("Notifications disabled");
    }
    announcePushPref(v);
  };
  const runPushTest = async () => {
    setTestingPush(true);
    setLastTest(null);
    try {
      const status = await pushStatus().catch(() => null);
      if (status) setPushState(status);
      const diag = await pushDiagnostics().catch(() => null);
      if (diag) setDeviceHint(diag.hint);

      if (!status?.configured) {
        setLastTest(
          `configured=false devices=${status?.devices ?? "?"} endpoint=${diag?.endpointHost ?? "none"}`,
        );
        toast.error("Server push isn't configured (missing VAPID keys). Add them and redeploy.");
        return;
      }
      if (!status.devices) {
        setLastTest(`configured=true devices=0 endpoint=${diag?.endpointHost ?? "none"}`);
        toast.error("No device registered yet — tap Enable above and allow notifications.");
        return;
      }
      const res = await sendTestPush();
      setLastTest(
        `configured=${res.configured} devices=${status.devices} sent=${res.sent} source=${status.source} endpoint=${diag?.endpointHost ?? "none"}`,
      );
      if (res.sent > 0) {
        toast.success(`Test sent to ${res.sent} device${res.sent === 1 ? "" : "s"} — check your tray`);
      } else {
        toast.error("Test couldn't be delivered. The saved subscription may be stale — tap Enable again.");
      }
    } catch (e) {
      setLastTest(`error: ${e instanceof Error ? e.message : "unknown"}`);
      toast.error("Test notification failed to send");
    } finally {
      setTestingPush(false);
    }
  };
const changeTheme = (t: string) => {
  setTheme(t);
  writePref("theme", t);
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

  // Subscriptions screen, opened from the Settings list.
  if (showSubscriptions) {
    return (
      <div className="mx-auto max-w-xl pb-10">
        <div className="flex items-center gap-3 px-4 pt-6">
          <button
            onClick={() => setShowSubscriptions(false)}
            aria-label="Back to settings"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="font-display text-2xl">Subscriptions</h1>
        </div>
        <Suspense fallback={<p className="px-4 pt-4 text-sm text-muted-foreground">Loading plans…</p>}>
          <SubscriptionsPanel handle={auth.handle} onSignIn={auth.signIn} />
        </Suspense>
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

      {/* Subscriptions (moved here from the top tab row) */}
      <div className="rounded-2xl border bg-card p-4">
        <h2 className="font-semibold">Subscriptions</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your plan, free trial, payment method, and billing.
        </p>
        <button
          onClick={() => setShowSubscriptions(true)}
          className="mt-3 flex w-full items-center justify-between rounded-md border bg-background px-4 py-3 text-left text-sm font-medium transition-colors hover:bg-accent"
        >
          <span className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            {subscription?.status === "active"
              ? "Your subscription is active"
              : subscription?.status === "trial"
                ? `Free trial — ${trialDaysLeft(subscription)} ${trialDaysLeft(subscription) === 1 ? "day" : "days"} left`
                : subscription?.status === "pending"
                  ? "Payment pending"
                  : subscription?.status === "expired"
                    ? "Subscription expired — renew"
                    : "View plans and start a free trial"}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </button>
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
        <p className="mt-1 text-sm text-muted-foreground">Turn all notifications on or off.</p>
        <div className="mt-3 flex gap-2">
          <button onClick={() => toggleNotifications(true)} className={`rounded-md px-3 py-2 ${notificationsEnabled ? "bg-primary text-primary-foreground" : "border bg-background"}`}>
            Enable
          </button>
          <button onClick={() => toggleNotifications(false)} className={`rounded-md px-3 py-2 ${!notificationsEnabled ? "bg-primary text-primary-foreground" : "border bg-background"}`}>
            Disable
          </button>
          <button onClick={runPushTest} disabled={testingPush} className="rounded-md border bg-background px-3 py-2 disabled:opacity-50">
            {testingPush ? "Sending…" : "Send test"}
          </button>
        </div>
        {pushState && (
          <p className="mt-2 text-xs text-muted-foreground">
            {!pushState.configured
              ? "Out-of-app push is not configured on the server (missing VAPID keys)."
              : pushState.devices > 0
                ? `Out-of-app push ready — ${pushState.devices} device${pushState.devices === 1 ? "" : "s"} registered (keys from ${pushState.source ?? "unknown"}).`
                : "Push is configured, but this device isn't registered yet. Tap Enable."}
          </p>
        )}
        {deviceHint && (
          <p className="mt-1 text-xs text-amber-500">{deviceHint}</p>
        )}
        {lastTest && (
          <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
            {lastTest}
          </p>
        )}
      </div>
             <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Social Links - Add to Your Profile</h2>
          <p className="mt-1 text-sm text-muted-foreground"> add your links </p>
          <div className="mt-3 space-y-3">
            <div className="flex gap-2">
              <span className="flex items-center rounded-md border bg-muted px-3 text-sm">TikTok</span>
              <input 
                value={tiktokLink} 
                onChange={(e) => setTiktokLink(e.target.value)} 
                placeholder="https://tiktok.com/@yourname" 
                className="flex-1 rounded-md border bg-background p-2" 
              />
            </div>
            <div className="flex gap-2">
              <span className="flex items-center rounded-md border bg-muted px-3 text-sm">IG</span>
              <input 
                value={instagramLink} 
                onChange={(e) => setInstagramLink(e.target.value)} 
                placeholder="https://instagram.com/yourname" 
                className="flex-1 rounded-md border bg-background p-2" 
              />
            </div>
            <div className="flex gap-2">
              <span className="flex items-center rounded-md border bg-muted px-3 text-sm">YouTube</span>
              <input 
                value={youtubeLink} 
                onChange={(e) => setYoutubeLink(e.target.value)} 
                placeholder="https://youtube.com/@yourname" 
                className="flex-1 rounded-md border bg-background p-2" 
              />
            </div>
            <button onClick={saveLinks} style={{backgroundColor: "black", color: "white"}} className="rounded-md px-4 py-2 font-medium">
              Save Links to Profile
            </button>
            {tiktokLink && (
              <div className="mt-2 flex gap-2">
                <a href={tiktokLink} target="_blank" style={{backgroundColor: "black", color: "white"}} className="rounded-md px-3 py-1 text-xs">View TikTok</a>
                <span className="text-xs text-muted-foreground truncate">{tiktokLink}</span>
              </div>
            )}
          </div>
        </div> 
{/* DIFFERENT MESSAGE SETTINGS - BLACK + WHITE */}
<div className="rounded-xl p-4 mb-4 shadow-sm" style={{backgroundColor:"black", color:"white"}}>
  <h2 className="font-bold text- mb-1" style={{color:"white"}}>💬 Message Privacy</h2>
  <p className="text- mb-4" style={{color:"#9ca3af"}}>Different settings like TikTok</p>

  <p className="font-bold text- mb-2" style={{color:"white"}}>Who can DM you</p>
  <div className="flex flex-col gap-2 mb-5">
    {[
      { id: "everyone", label: "Everyone" },
      { id: "friends", label: "Friends" },
      { id: "mutuals", label: "Friends of friends" },
      { id: "noone", label: "No one" },
    ].map(o=>(
      <button key={o.id} onClick={()=>{setMessagePrivacy(o.id); localStorage.setItem("messagePrivacy", o.id);}} className="flex justify-between p-3 rounded-xl border text-left" style={{backgroundColor: messagePrivacy===o.id ? "white" : "#1f1f1f", color: messagePrivacy===o.id ? "black" : "white", borderColor: messagePrivacy===o.id ? "white" : "#333"}}>
        <span className="font-medium text-">{o.label}</span>
        <div className="h-5 w-5 rounded-full border-2 flex items-center justify-center" style={{borderColor: messagePrivacy===o.id ? "black" : "#666"}}>
          {messagePrivacy===o.id && <div className="h-2 w-2 bg-black rounded-full" />}
        </div>
      </button>
    ))}
  </div>

  <p className="font-bold text- mb-2" style={{color:"white"}}>Message requests</p>
  <div className="flex gap-2 mb-5">
    {["all","filtered","off"].map(id=>(
      <button key={id} onClick={()=>{setMessageFilter(id); localStorage.setItem("messageFilter", id);}} className="flex-1 py-2 rounded-full font-bold text- border" style={{backgroundColor: messageFilter===id ? "white" : "#1f1f1f", color: messageFilter===id ? "black" : "white", borderColor: "#333"}}>{id}</button>
    ))}
  </div>

  <div className="border-t" style={{borderColor:"#333"}}>
    <div className="flex justify-between items-center py-3">
      <div><div className="font-medium text-" style={{color:"white"}}>Allow DMs</div><div className="text-" style={{color:"#9ca3af"}}>Let others message you</div></div>
      <button onClick={()=>{const v=!allowDM; setAllowDM(v); localStorage.setItem("allowDM", String(v));}} className="h-7 w-12 rounded-full p-1" style={{backgroundColor: allowDM ? "white" : "#333"}}><div className="h-5 w-5 rounded-full transition" style={{backgroundColor: allowDM ? "black" : "white", transform: allowDM ? "translateX(20px)" : "translateX(0)"}} /></button>
    </div>
    <div className="flex justify-between items-center py-3 border-t" style={{borderColor:"#333"}}>
      <div><div className="font-medium text-" style={{color:"white"}}>Read receipts</div><div className="text-" style={{color:"#9ca3af"}}>Show when read</div></div>
      <button onClick={()=>{const v=!readReceipts; setReadReceipts(v); localStorage.setItem("readReceipts", String(v));}} className="h-7 w-12 rounded-full p-1" style={{backgroundColor: readReceipts ? "white" : "#333"}}><div className="h-5 w-5 rounded-full transition" style={{backgroundColor: readReceipts ? "black" : "white", transform: readReceipts ? "translateX(20px)" : "translateX(0)"}} /></button>
    </div>
  </div>
</div>
              <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Phone Number</h2>
          <p className="mt-1 text-sm text-muted-foreground">Add your phone number to your account </p>
          <div className="mt-3 flex gap-2">
            <input 
              value={phone} 
              onChange={(e) => setPhone(e.target.value)} 
              placeholder="+1 (555) 000-0000" 
              type="tel"
              className="flex-1 rounded-md border bg-background p-2" 
            />
            <button onClick={savePhone} style={{backgroundColor: "black", color: "white"}} className="rounded-md px-4 py-2 font-medium">
              Save
            </button>
          </div>
          {phone && <p className="mt-2 text-xs text-muted-foreground">Saved: {phone}</p>}
        </div>
<div className="rounded-lg border bg-card p-6">
  <div className="flex items-center gap-2">
    <h2 className="font-semibold">Offline Mode</h2>
    {!offlineUnlocked && (
      <span className="rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
        Plus
      </span>
    )}
  </div>

  {offlineUnlocked ? (
    <>
      <p className="mt-1 text-sm text-muted-foreground">Save videos and watch them without a connection.</p>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={toggleOffline} style={{backgroundColor: offlineMode ? "#16a34a" : "black", color: "white"}} className="rounded-md px-4 py-2 font-medium">
          {offlineMode ? "ON" : "OFF"}
        </button>
        <button onClick={() => window.location.href = "/offline"} style={{backgroundColor: "black", color: "white"}} className="rounded-md px-4 py-2 font-medium">
          View Offline Videos →
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {offlineMode ? "Tap View to see your saved videos" : "Turn ON first, then view"}
      </p>
      {subscription?.status === "trial" && (
        <p className="mt-1 text-xs text-muted-foreground">
          Included with your free trial — offline mode locks when the trial ends unless you subscribe.
        </p>
      )}
    </>
  ) : (
    <>
      <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
        <Lock className="h-4 w-4" />
        Offline mode is a Plus feature. Subscribe to save videos and watch them without a connection.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => setShowSubscriptions(true)}
          style={{backgroundColor: "black", color: "white"}}
          className="rounded-md px-4 py-2 font-medium"
        >
          Get Plus — ${offlinePrice.toFixed(2)}/mo
        </button>
        <button onClick={() => window.location.href = "/offline"} className="rounded-md border px-4 py-2 font-medium">
          See what's included
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {subscription?.status === "expired" || subscription?.status === "pending"
          ? "Your subscription isn't active, so offline mode is locked."
          : "Already subscribed? Offline mode unlocks as soon as your plan is active."}
      </p>
    </>
  )}
</div>
   {/* Appearance */}
<div className="rounded-2xl border bg-card p-4">
  <h2 className="font-semibold">Appearance</h2>
  <p className="mt-1 text-sm text-muted-foreground">Choose an app theme.</p>
<div className="mt-3 flex flex-wrap gap-2">
  <button onClick={() => changeTheme("light")} style={{backgroundColor: "white", color: "black"}} className="rounded-md px-3 py-2 border">Light</button>
  <button onClick={() => changeTheme("dark")} style={{backgroundColor: "black", color: "white"}} className="rounded-md px-3 py-2 border">Dark</button>
  <button onClick={() => changeTheme("system")} style={{backgroundColor: "#e4e4e7", color: "black"}} className="rounded-md px-3 py-2 border">System</button>
  <button onClick={() => changeTheme("blue")} style={{backgroundColor: "#2563EB", color: "white"}} className="rounded-md px-3 py-2">Blue</button>
  <button onClick={() => changeTheme("purple")} style={{backgroundColor: "#9333ea", color: "white"}} className="rounded-md px-3 py-2">Purple</button>
  <button onClick={() => changeTheme("pink")} style={{backgroundColor: "#ec4899", color: "white"}} className="rounded-md px-3 py-2">Pink</button>
  <button onClick={() => changeTheme("green")} style={{backgroundColor: "#16a34a", color: "white"}} className="rounded-md px-3 py-2">Green</button>
</div>
</div> 

      <MoreSettings />

      {auth.user && <EditProfileDialog open={editing} onOpenChange={setEditing} />}
    </div>
  );
}
