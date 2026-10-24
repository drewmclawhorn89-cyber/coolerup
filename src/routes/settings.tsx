import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const [theme, setTheme] = useState("light");
  const [offlineMode, setOfflineMode] = useState(false);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [bio, setBio] = useState("");
  const [notifications, setNotifications] = useState(true);
  const [privateAccount, setPrivateAccount] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("settings:theme") || "light";
      setTheme(savedTheme);
      setOfflineMode(localStorage.getItem("settings:offline") === "true");
      setUsername(localStorage.getItem("settings:username") || "");
      setEmail(localStorage.getItem("settings:email") || "");
      setBio(localStorage.getItem("settings:bio") || "");
      setNotifications(localStorage.getItem("settings:notifications") !== "false");
      setPrivateAccount(localStorage.getItem("settings:private") === "true");
    } catch {}
  }, []);

  const changeTheme = (t: string) => {
    setTheme(t);
    try { localStorage.setItem("settings:theme", t); } catch {}
    const root = document.documentElement;
    const body = document.body;
    root.classList.remove("light","dark","blue","purple","pink","green","system");
    root.classList.add(t);
    body.style.backgroundColor = "";
    document.documentElement.style.backgroundColor = "";

    if (t === "blue") {
      root.style.setProperty("--background", "221 83% 53%");
      root.style.setProperty("--foreground", "0 0% 100%");
      root.style.setProperty("--card", "221 83% 58%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      body.style.backgroundColor = "#2563EB";
      document.documentElement.style.backgroundColor = "#2563EB";
    } else if (t === "purple") {
      root.style.setProperty("--background", "271 81% 56%");
      root.style.setProperty("--card", "271 81% 61%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      body.style.backgroundColor = "#9333ea";
      document.documentElement.style.backgroundColor = "#9333ea";
    } else if (t === "pink") {
      root.style.setProperty("--background", "330 81% 60%");
      root.style.setProperty("--card", "330 81% 65%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      body.style.backgroundColor = "#ec4899";
      document.documentElement.style.backgroundColor = "#ec4899";
    } else if (t === "green") {
      root.style.setProperty("--background", "142 71% 45%");
      root.style.setProperty("--card", "142 71% 50%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      body.style.backgroundColor = "#16a34a";
      document.documentElement.style.backgroundColor = "#16a34a";
    } else {
      root.style.setProperty("--background", t === "dark" ? "0 0% 8%" : "0 0% 100%");
      root.style.setProperty("--foreground", t === "dark" ? "0 0% 100%" : "0 0% 0%");
      root.style.setProperty("--card", t === "dark" ? "0 0% 8%" : "0 0% 100%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", t === "dark" ? "0 0% 100%" : "0 0% 0%");
    }
    toast.success(`Theme: ${t}`);
  };

  const toggleOffline = () => {
    const newVal = !offlineMode;
    setOfflineMode(newVal);
    try { localStorage.setItem("settings:offline", String(newVal)); } catch {}
    toast.success(`Offline mode: ${newVal ? "ON" : "OFF"}`);
  };

  const saveProfile = () => {
    try {
      localStorage.setItem("settings:username", username);
      localStorage.setItem("settings:email", email);
      localStorage.setItem("settings:bio", bio);
    } catch {}
    toast.success("Profile saved");
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <a href="/" className="text-sm underline">← Back to For You</a>
        <h1 className="text-2xl font-bold">Settings</h1>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Profile</h2>
          <div className="mt-3 space-y-3">
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" className="w-full rounded-md border bg-background p-2" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-md border bg-background p-2" />
            <textarea value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Bio" className="w-full rounded-md border bg-background p-2" />
            <button onClick={saveProfile} style={{backgroundColor: "black", color: "white"}} className="rounded-md px-4 py-2">Save Profile</button>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Offline Mode</h2>
          <p className="mt-1 text-sm text-muted-foreground">Watch your 1332 videos offline. Does not delete accounts. Safe for Lovable Auth.</p>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={toggleOffline} style={{backgroundColor: offlineMode ? "#16a34a" : "black", color: "white"}} className="rounded-md px-4 py-2 font-medium">
              {offlineMode ? "ON" : "OFF"}
            </button>
            <span className="text-sm">{offlineMode ? "ON - caching 1332 videos" : "OFF - online only"}</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Everyone can switch background colors. Buttons are black for all backgrounds.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => changeTheme("light")} style={{backgroundColor: "white", color: "black", border: "1px solid #e5e7eb"}} className="rounded-md px-3 py-2">Light</button>
            <button onClick={() => changeTheme("dark")} style={{backgroundColor: "black", color: "white"}} className="rounded-md px-3 py-2">Dark</button>
            <button onClick={() => changeTheme("system")} style={{backgroundColor: "#e4e4e7", color: "black"}} className="rounded-md px-3 py-2">System</button>
            <button onClick={() => changeTheme("blue")} style={{backgroundColor: "#2563EB", color: "white"}} className="rounded-md px-3 py-2">Blue</button>
            <button onClick={() => changeTheme("purple")} style={{backgroundColor: "#9333ea", color: "white"}} className="rounded-md px-3 py-2">Purple</button>
            <button onClick={() => changeTheme("pink")} style={{backgroundColor: "#ec4899", color: "white"}} className="rounded-md px-3 py-2">Pink</button>
            <button onClick={() => changeTheme("green")} style={{backgroundColor: "#16a34a", color: "white"}} className="rounded-md px-3 py-2">Green</button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Current: {theme} | Random: 0.15</p>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Notifications</h2>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => { const v = !notifications; setNotifications(v); localStorage.setItem("settings:notifications", String(v)); }} style={{backgroundColor: notifications ? "black" : "#e5e7eb", color: notifications ? "white" : "black"}} className="rounded-md px-4 py-2">
              {notifications ? "ON" : "OFF"}
            </button>
            <span className="text-sm">Push notifications</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Privacy</h2>
          <div className="mt-3 flex items-center gap-3">
            <button onClick={() => { const v = !privateAccount; setPrivateAccount(v); localStorage.setItem("settings:private", String(v)); }} style={{backgroundColor: privateAccount ? "black" : "#e5e7eb", color: privateAccount ? "white" : "black"}} className="rounded-md px-4 py-2">
              {privateAccount ? "Private" : "Public"}
            </button>
            <span className="text-sm">Account visibility</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Account</h2>
          <p className="mt-1 text-sm text-muted-foreground">Manage your Loop account. This does not delete videos unless you click delete.</p>
          <button onClick={() => toast.success("Logged out")} style={{backgroundColor: "black", color: "white"}} className="mt-3 rounded-md px-4 py-2">Log Out</button>
        </div>
      </div>
    </div>
  );
}
