import { useState } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";

const read = (k: string, d: string) => {
  try { return localStorage.getItem(`settings:${k}`) ?? d; } catch { return d; }
};
const write = (k: string, v: string) => {
  try { localStorage.setItem(`settings:${k}`, v); } catch { /* ignore */ }
};

function Toggle({ id, label, desc, def = false }: { id: string; label: string; desc?: string; def?: boolean }) {
  const [on, setOn] = useState(read(id, String(def)) === "true");
  return (
    <div className="flex items-center justify-between gap-3 border-t py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        {desc && <div className="text-sm text-muted-foreground">{desc}</div>}
      </div>
      <Switch checked={on} onCheckedChange={(v) => { setOn(v); write(id, String(v)); }} />
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

export function MoreSettings() {
  const soon = (what: string) => () => toast(`${what} is coming soon`);
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
        <Toggle id="data-saver" label="Data saver" desc="Use less mobile data" />
        <Toggle id="wifi-upload" label="Upload over Wi-Fi only" />
        <Choice id="language" label="App language" options={["English", "Español", "Français", "Deutsch", "Português"]} def="English" />
        <Choice id="region" label="Content language" options={["All", "English", "Español", "Français"]} def="All" />
        <Row label="Not interested / keywords" desc="Filter videos by keyword" onClick={soon("Keyword filters")} />
      </Card>
      <Card title="Digital wellbeing">
        <Choice id="screen-time" label="Daily screen time limit" options={["Off", "30 min", "1 hour", "2 hours", "3 hours"]} def="Off" />
        <Choice id="break-reminder" label="Screen time breaks" options={["Off", "Every 30 min", "Every hour"]} def="Off" />
        <Toggle id="sleep-reminder" label="Sleep reminders" />
      </Card>
      <Card title="Security and login">
        <Toggle id="2fa" label="2-step verification" />
        <Toggle id="login-alerts" label="Login alerts" def />
        <Row label="Manage devices" onClick={soon("Device management")} />
        <Row label="Change password" onClick={soon("Password change")} />
        <Row label="Download your data" onClick={soon("Data export")} />
      </Card>
      <Card title="Accessibility">
        <Toggle id="reduce-motion" label="Reduce motion" />
        <Toggle id="large-text" label="Larger text" />
        <Toggle id="haptics" label="Haptic feedback" def />
        <Toggle id="screen-reader" label="Screen reader support" />
      </Card>
      <Card title="Cache and storage">
        <Row label="Clear cache" desc="Frees up space used by temporary files" onClick={() => {
          try { void caches?.keys().then((ks) => ks.forEach((k) => void caches.delete(k))); } catch { /* ignore */ }
          toast.success("Cache cleared");
        }} />
      </Card>
      <Card title="Support and about">
        <Row label="Report a problem" onClick={soon("Problem reports")} />
        <Row label="Help center" onClick={soon("Help center")} />
        <Row label="Community guidelines" onClick={soon("Guidelines")} />
        <Row label="Terms of service" onClick={soon("Terms")} />
        <Row label="Privacy policy" onClick={soon("Privacy policy")} />
      </Card>
      <Card title="Account control">
        <Row label="Deactivate account" onClick={soon("Deactivation")} danger />
        <Row label="Delete account" onClick={soon("Account deletion")} danger />
      </Card>
    </>
  );
}
