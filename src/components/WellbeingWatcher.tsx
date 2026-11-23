import { useEffect } from "react";
import { toast } from "sonner";
import { readPref as read } from "@/lib/prefs";

const LIMITS: Record<string, number> = {
  "30 min": 30,
  "1 hour": 60,
  "2 hours": 120,
  "3 hours": 180,
};
const BREAKS: Record<string, number> = { "Every 30 min": 30, "Every hour": 60 };

/**
 * Mount once at the app root: enforces screen-time limit, break and sleep reminders.
 * Kept separate from MoreSettings so the rest of MoreSettings stays code-split
 * inside Settings and does not ship in the initial Home bundle.
 */
export function WellbeingWatcher() {
  useEffect(() => {
    let sinceBreak = 0;
    let sleepShown = "";
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const day = new Date().toDateString();
      let used = 0;
      try {
        const raw = JSON.parse(localStorage.getItem("settings:usage") || "{}") as {
          day?: string;
          min?: number;
        };
        used = raw.day === day ? (raw.min ?? 0) : 0;
        used += 1;
        localStorage.setItem("settings:usage", JSON.stringify({ day, min: used }));
      } catch {
        /* ignore */
      }
      sinceBreak += 1;
      const limit = LIMITS[read("screen-time", "Off")];
      if (limit && used === limit)
        toast.warning(`You've reached your daily limit of ${read("screen-time", "")}.`, {
          duration: 10000,
        });
      const brk = BREAKS[read("break-reminder", "Off")];
      if (brk && sinceBreak >= brk) {
        sinceBreak = 0;
        toast("Time for a break — you've been scrolling a while.", { duration: 8000 });
      }
      if (
        read("sleep-reminder", "false") === "true" &&
        new Date().getHours() >= 22 &&
        sleepShown !== day
      ) {
        sleepShown = day;
        toast("It's getting late. Consider winding down for sleep.", { duration: 8000 });
      }
    }, 60000);
    return () => window.clearInterval(id);
  }, []);
  return null;
}
