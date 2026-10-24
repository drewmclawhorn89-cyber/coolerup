import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function Settings() {
  const [theme, setTheme] = useState("light");
  const [offlineMode, setOfflineMode] = useState(false);

  useEffect(() => {
    try {
      const savedTheme = localStorage.getItem("settings:theme") || "light";
      setTheme(savedTheme);
      const savedOffline = localStorage.getItem("settings:offline") === "true";
      setOfflineMode(savedOffline);
      // apply saved theme on load
      const root = document.documentElement;
      if (savedTheme === "blue") {
        root.style.setProperty("--background", "221 83% 53%");
        root.style.setProperty("--foreground", "0 0% 100%");
        root.style.setProperty("--card", "221 83% 58%");
        root.style.setProperty("--primary", "0 0% 0%");
        root.style.setProperty("--primary-foreground", "0 0% 100%");
        root.style.setProperty("--ring", "0 0% 0%");
        document.body.style.backgroundColor = "#2563EB";
      }
    } catch {}
  }, []);

  const changeTheme = (t: string) => {
    setTheme(t);
    try { localStorage.setItem("settings:theme", t); } catch {}
    const root = document.documentElement;
    root.classList.remove("light", "dark", "blue", "purple", "pink", "green", "system");
    root.classList.add(t);

    // reset body bg
    document.body.style.backgroundColor = "";
    document.documentElement.style.backgroundColor = "";

    if (t === "light") {
      root.setAttribute("data-theme", "light");
      root.style.setProperty("--background", "0 0% 100%");
      root.style.setProperty("--foreground", "0 0% 0%");
      root.style.setProperty("--card", "0 0% 100%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
    } else if (t === "dark") {
      root.setAttribute("data-theme", "dark");
      root.style.setProperty("--background", "0 0% 8%");
      root.style.setProperty("--foreground", "0 0% 100%");
      root.style.setProperty("--card", "0 0% 8%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 100%");
    } else if (t === "system") {
      const isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      root.setAttribute("data-theme", isDark ? "dark" : "light");
      root.style.setProperty("--background", isDark ? "0 0% 8%" : "0 0% 100%");
      root.style.setProperty("--foreground", isDark ? "0 0% 100%" : "0 0% 0%");
      root.style.setProperty("--card", isDark ? "0 0% 8%" : "0 0% 100%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", isDark ? "0 0% 100%" : "0 0% 0%");
    } else if (t === "blue") {
      root.setAttribute("data-theme", "light");
      root.style.setProperty("--background", "221 83% 53%");
      root.style.setProperty("--foreground", "0 0% 100%");
      root.style.setProperty("--card", "221 83% 58%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      document.body.style.backgroundColor = "#2563EB";
      document.documentElement.style.backgroundColor = "#2563EB";
    } else if (t === "purple") {
      root.setAttribute("data-theme", "light");
      root.style.setProperty("--background", "271 81% 56%");
      root.style.setProperty("--foreground", "0 0% 100%");
      root.style.setProperty("--card", "271 81% 61%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      document.body.style.backgroundColor = "#9333ea";
      document.documentElement.style.backgroundColor = "#9333ea";
    } else if (t === "pink") {
      root.setAttribute("data-theme", "light");
      root.style.setProperty("--background", "330 81% 60%");
      root.style.setProperty("--foreground", "0 0% 100%");
      root.style.setProperty("--card", "330 81% 65%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      document.body.style.backgroundColor = "#ec4899";
      document.documentElement.style.backgroundColor = "#ec4899";
    } else if (t === "green") {
      root.setAttribute("data-theme", "light");
      root.style.setProperty("--background", "142 71% 45%");
      root.style.setProperty("--foreground", "0 0% 100%");
      root.style.setProperty("--card", "142 71% 50%");
      root.style.setProperty("--primary", "0 0% 0%");
      root.style.setProperty("--primary-foreground", "0 0% 100%");
      root.style.setProperty("--ring", "0 0% 0%");
      document.body.style.backgroundColor = "#16a34a";
      document.documentElement.style.backgroundColor = "#16a34a";
    }

    toast.success(`Theme: ${t}`);
  };

  const toggleOffline = () => {
    const newVal = !offlineMode;
    setOfflineMode(newVal);
    try { localStorage.setItem("settings:offline", String(newVal)); } catch {}
    if (newVal && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    toast.success(`Offline mode: ${newVal ? "ON" : "OFF"}`);
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-2xl font-bold">Settings</h1>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Offline Mode</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Watch your 1332 videos offline. Does not delete accounts.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={toggleOffline}
              style={{backgroundColor: offlineMode ? "#16a34a" : "black", color: "white"}}
              className="rounded-md px-4 py-2 font-medium"
            >
              {offlineMode ? "ON" : "OFF"}
            </button>
            <span className="text-sm">{offlineMode ? "ON - caching for offline" : "OFF - online only"}</span>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6">
          <h2 className="font-semibold">Appearance</h2>
          <p className="mt-1 text-sm text-muted-foreground">Everyone can switch background colors. Buttons are black for all colors.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={() => changeTheme("light")} style={{backgroundColor: "white", color: "black", border: "1px solid #e5e7eb"}} className="rounded-md px-3 py-2">Light</button>
            <button onClick={() => changeTheme("dark")} style={{backgroundColor: "black", color: "white"}} className="rounded-md px-3 py-2">Dark</button>
            <button onClick={() => changeTheme("system")} style={{backgroundColor: "#e4e4e7", color: "black"}} className="rounded-md px-3 py-2">System</button>
            <button onClick={() => changeTheme("blue")} style={{backgroundColor: "#2563EB", color: "white"}} className="rounded-md px-3 py-2">Blue</button>
            <button onClick={() => changeTheme("purple")} style={{backgroundColor: "#9333ea", color: "white"}} className="rounded-md px-3 py-2">Purple</button>
            <button onClick={() => changeTheme("pink")} style={{backgroundColor: "#ec4899", color: "white"}} className="rounded-md px-3 py-2">Pink</button>
            <button onClick={() => changeTheme("green")} style={{backgroundColor: "#16a34a", color: "white"}} className="rounded-md px-3 py-2">Green</button>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Current: {theme} | Videos: 1332 | Random: 0.15</p>
        </div>
      </div>
    </div>
  );
}
