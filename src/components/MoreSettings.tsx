import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

import { allPrefs, readPref as read, writePref as write } from "@/lib/prefs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { deleteMyAccount } from "@/lib/push.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

function Toggle({ id, label, desc, def = false }: { id: string; label: string; desc?: string; def?: boolean }) {
  const [on, setOn] = useState(read(id, String(def)) === "true");
  const change = async (v: boolean) => {
    if (v && id.startsWith("n-") && typeof Notification !== "undefined" && Notification.permission === "default") {
      const p = await Notification.requestPermission();
      if (p !== "granted") toast("Browser notifications are blocked. Enable them in your browser settings.");
    }
    if (v && id === "contacts-sync") toast("Contact sync needs device permission and is limited on the web.");
    setOn(v);
    write(id, String(v));
  };
  return (
    <div className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {desc && <div className="text-sm text-muted-foreground">{desc}</div>}
      </div>
      <Switch checked={on} onCheckedChange={(v) => void change(v)} aria-label={label} />
    </div>
  );
}

function Choice({ id, label, options, def }: { id: string; label: string; options: string[]; def: string }) {
  const [v, setV] = useState(read(id, def));
  return (
    <div className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0">
      <div className="font-medium">{label}</div>
      <select value={v} onChange={(e) => { setV(e.target.value); write(id, e.target.value); }} className="rounded-md border bg-background p-2 text-base">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
    </div>
  );
}

function Row({ label, desc, onClick, danger }: { label: string; desc?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center justify-between border-t py-3 text-left first:border-t-0 ${danger ? "text-destructive" : ""}`}>
      <span><span className="block font-medium">{label}</span>{desc && <span className="block text-sm text-muted-foreground">{desc}</span>}</span>
      <span className="text-muted-foreground">›</span>
    </button>
  );
}

const Card = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-lg border bg-card p-6">
    <h2 className="mb-2 font-semibold">{title}</h2>
    {children}
  </div>
);

const WHO = ["Everyone", "Friends", "Only me"];

const INFO: Record<string, string[]> = {
  "Help center": [
    "Edit your profile, handle and links from the top of Settings.",
    "Tap Share → Save for offline on a video to watch it without a connection.",
    "Block or report anyone from their profile or from a video's menu.",
  ],
  "Community guidelines": [
    "Be kind. No harassment, hate speech, threats or bullying.",
    "No nudity, graphic violence or content that endangers minors.",
    "Only post content you have the right to share.",
    "Accounts that repeatedly break these rules may be banned.",
  ],
  "Terms of service": [
    "You are responsible for the content you post and your account activity.",
    "You grant Coolerup a licence to host and display the content you upload.",
    "We may remove content or suspend accounts that violate our guidelines.",
  ],
  "Privacy policy": [
    "We store your profile, videos, likes, follows and messages to run the app.",
    "Your display preferences are stored on your device.",
    "You can download your data or delete your account at any time in Settings.",
  ],
};

const LIMITS: Record<string, number> = { "30 min": 30, "1 hour": 60, "2 hours": 120, "3 hours": 180 };
const BREAKS: Record<string, number> = { "Every 30 min": 30, "Every hour": 60 };

/** Mount once at the app root: enforces screen-time limit, break and sleep reminders. */
export function WellbeingWatcher() {
  useEffect(() => {
    let sinceBreak = 0;
    let sleepShown = "";
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const day = new Date().toDateString();
      let used = 0;
      try {
        const raw = JSON.parse(localStorage.getItem("settings:usage") || "{}") as { day?: string; min?: number };
        used = raw.day === day ? raw.min ?? 0 : 0;
        used += 1;
        localStorage.setItem("settings:usage", JSON.stringify({ day, min: used }));
      } catch { /* ignore */ }
      sinceBreak += 1;
      const limit = LIMITS[read("screen-time", "Off")];
      if (limit && used === limit) toast.warning(`You've reached your daily limit of ${read("screen-time", "")}.`, { duration: 10000 });
      const brk = BREAKS[read("break-reminder", "Off")];
      if (brk && sinceBreak >= brk) { sinceBreak = 0; toast("Time for a break — you've been scrolling a while.", { duration: 8000 }); }
      if (read("sleep-reminder", "false") === "true" && new Date().getHours() >= 22 && sleepShown !== day) {
        sleepShown = day;
        toast("It's getting late. Consider winding down for sleep.", { duration: 8000 });
      }
    }, 60000);
    return () => window.clearInterval(id);
  }, []);
  return null;
}

export function MoreSettings() {
  const auth = useAuth();
  const [info, setInfo] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"deactivate" | "delete" | null>(null);
  const [busy, setBusy] = useState(false);
  const needAuth = () => {
    if (auth.user) return false;
    toast.error("Sign in first");
    return true;
  };

  const keywords = () => {
    const v = window.prompt("Hide videos whose caption contains these words (comma separated):", read("keywords", ""));
    if (v === null) return;
    write("keywords", v);
    toast.success(v.trim() ? "Keyword filter saved" : "Keyword filter cleared");
  };
  const devices = async () => {
    if (needAuth()) return;
    if (!window.confirm("Sign out of all other devices?")) return;
    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) toast.error("Couldn't sign out other devices");
    else toast.success("Signed out of all other devices");
  };
  const password = async () => {
    if (needAuth()) return;
    const pw = window.prompt("Enter a new password (at least 8 characters):");
    if (pw === null) return;
    if (pw.length < 8) { toast.error("Password must be at least 8 characters"); return; }
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) toast.error(error.message || "Couldn't change password");
    else toast.success("Password updated");
  };
  const exportData = async () => {
    if (needAuth()) return;
    const uid = auth.user!.id;
    const [vids, follows] = await Promise.all([
      supabase.from("videos").select("*").eq("username", auth.handle ?? ""),
      supabase.from("follows").select("*").eq("follower_id", uid),
    ]);
    const blob = new Blob(
      [JSON.stringify({ exportedAt: new Date().toISOString(), profile: auth.profile, settings: allPrefs(), videos: vids.data ?? [], following: follows.data ?? [] }, null, 2)],
      { type: "application/json" },
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "coolerup-data.json";
    a.click();
    URL.revokeObjectURL(a.href);
    toast.success("Your data was downloaded");
  };
  const report = () => {
    const text = window.prompt("Describe the problem:");
    if (!text?.trim()) return;
    window.location.href = `mailto:?subject=${encodeURIComponent("Coolerup problem report")}&body=${encodeURIComponent(text)}`;
  };
  const clearCache = async () => {
    try {
      const ks = await caches.keys();
      await Promise.all(ks.map((k) => caches.delete(k)));
    } catch { /* ignore */ }
    toast.success("Cache cleared");
  };
  const runConfirmed = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === "delete") await deleteMyAccount();
      await supabase.auth.signOut();
      toast.success(confirm === "delete" ? "Account deleted" : "Signed out. Sign in again to reactivate.");
      setConfirm(null);
      window.location.href = "/";
    } catch {
      toast.error("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  const open = (t: string) => () => setInfo(t);

  return (
    <>
      <Card title="Push notifications">
        <Toggle id="n-likes" label="Likes" def />
        <Toggle id="n-comments" label="Comments" def />
        <Toggle id="n-followers" label="New followers" def />
        <Toggle id="n-mentions" label="Mentions and tags" def />
        <Toggle id="n-messages" label="Direct messages" def />
        <Toggle id="n-live" label="LIVE from people you follow" def />
        <Toggle id="n-suggest" label="Video suggestions" />
      </Card>
      <Card title="Privacy and interactions">
        <Choice id="who-comment" label="Who can comment" options={WHO} def="Everyone" />
        <Choice id="who-duet" label="Who can Duet with you" options={WHO} def="Everyone" />
        <Choice id="who-stitch" label="Who can Stitch with you" options={WHO} def="Everyone" />
        <Choice id="who-mention" label="Who can @mention you" options={WHO} def="Everyone" />
        <Choice id="who-likes" label="Who can view your liked videos" options={WHO} def="Only me" />
        <Toggle id="allow-download" label="Allow downloads of your videos" def />
        <Toggle id="suggest-account" label="Suggest your account to others" def />
        <Toggle id="activity-status" label="Activity status" desc="Let friends see when you're online" def />
        <Toggle id="profile-views" label="Profile view history" />
        <Toggle id="contacts-sync" label="Sync contacts to find friends" />
        <Toggle id="personalized-ads" label="Personalized ads" def />
      </Card>
      <Card title="Content preferences">
        <Toggle id="autoplay" label="Autoplay next video" def />
        <Toggle id="captions" label="Always show captions" />
        <Toggle id="restricted" label="Restricted mode" desc="Limit content that may not be right for everyone" />
        <Toggle id="lite-mode" label="Lite mode" desc="Load one video at a time and skip preloading on slow connections" />
        <Toggle id="data-saver" label="Data saver" desc="Use less mobile data (turns on automatically on 2G)" />
        <Toggle id="wifi-upload" label="Upload over Wi-Fi only" />
        <Choice id="language" label="App language" options={["English", "Español", "Français", "Deutsch", "Português"]} def="English" />
        <Choice id="region" label="Content language" options={["All", "English", "Español", "Français"]} def="All" />
        <Row label="Not interested / keywords" desc="Filter videos by keyword" onClick={keywords} />
      </Card>
      <Card title="Digital wellbeing">
        <Choice id="screen-time" label="Daily screen time limit" options={["Off", "30 min", "1 hour", "2 hours", "3 hours"]} def="Off" />
        <Choice id="break-reminder" label="Screen time breaks" options={["Off", "Every 30 min", "Every hour"]} def="Off" />
        <Toggle id="sleep-reminder" label="Sleep reminders" />
      </Card>
      <Card title="Security and login">
        <Toggle id="2fa" label="2-step verification" />
        <Toggle id="login-alerts" label="Login alerts" def />
        <Row label="Manage devices" onClick={() => void devices()} />
        <Row label="Change password" onClick={() => void password()} />
        <Row label="Download your data" onClick={() => void exportData()} />
      </Card>
      <Card title="Accessibility">
        <Toggle id="reduce-motion" label="Reduce motion" />
        <Toggle id="large-text" label="Larger text" />
        <Toggle id="haptics" label="Haptic feedback" def />
        <Toggle id="screen-reader" label="Screen reader support" />
      </Card>
      <Card title="Cache and storage">
        <Row label="Clear cache" desc="Frees up space used by temporary files" onClick={() => void clearCache()} />
      </Card>
      <Card title="Support and about">
        <Row label="Report a problem" onClick={report} />
        <Row label="Help center" onClick={open("Help center")} />
        <Row label="Community guidelines" onClick={open("Community guidelines")} />
        <Row label="Terms of service" onClick={open("Terms of service")} />
        <Row label="Privacy policy" onClick={open("Privacy policy")} />
      </Card>
      <Card title="Account control">
        <Row label="Deactivate account" onClick={() => !needAuth() && setConfirm("deactivate")} danger />
        <Row label="Delete account" onClick={() => !needAuth() && setConfirm("delete")} danger />
      </Card>
      <Dialog open={!!info} onOpenChange={(o) => !o && setInfo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{info}</DialogTitle></DialogHeader>
          <ul className="list-disc space-y-2 pl-5 text-sm">{(info ? INFO[info] ?? [] : []).map((l) => <li key={l}>{l}</li>)}</ul>
        </DialogContent>
      </Dialog>
      <Dialog open={!!confirm} onOpenChange={(o) => !o && !busy && setConfirm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{confirm === "delete" ? "Delete account?" : "Deactivate account?"}</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirm === "delete" ? "This permanently deletes your account and cannot be undone." : "You'll be signed out. Sign in again any time to reactivate."}
          </p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirm(null)} disabled={busy} className="rounded-md border px-4 py-2">Cancel</button>
            <button onClick={() => void runConfirmed()} disabled={busy} className="rounded-md bg-destructive px-4 py-2 text-white">{busy ? "Working..." : confirm === "delete" ? "Delete" : "Deactivate"}</button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
