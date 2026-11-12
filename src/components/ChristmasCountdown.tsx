import { useState, useEffect } from "react";

const TARGET = new Date("2026-11-15T00:00:00").getTime();
const HIDE_AFTER = new Date("2027-01-01").getTime();

type TimeLeft = { days: number; hours: number; minutes: number; seconds: number };

/** Split the remaining milliseconds into days / hours / minutes / seconds. */
function split(diff: number): TimeLeft {
  return {
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
    minutes: Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)),
    seconds: Math.floor((diff % (1000 * 60)) / 1000),
  };
}

/**
 * Pre-launch countdown to the Coolerup Christmas update, TikTok-style.
 *
 * Counts down to Nov 15 2026 00:00 local time and then hides itself for good,
 * so the banner is only ever visible before the update goes live. It also
 * disappears after Jan 1 2027 as a safety net.
 */
export const ChristmasCountdown = () => {
  // Seed from the real clock so the very first paint shows the right numbers
  // instead of a one-frame "0d 0h 0m 0s" flash.
  const [timeLeft, setTimeLeft] = useState<TimeLeft>(() => split(Math.max(TARGET - Date.now(), 0)));
  const [isLive, setIsLive] = useState(() => Date.now() >= TARGET);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const tick = () => {
      const diff = TARGET - Date.now();
      if (diff <= 0) {
        setIsLive(true);
        return false;
      }
      setTimeLeft(split(diff));
      return true;
    };

    // Paint immediately, then once a second until launch.
    if (!tick()) return;
    const timer = setInterval(() => {
      if (!tick()) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Hide once the Christmas update is live (Nov 15 2026).
  if (!mounted || isLive) return null;
  // Hide after Jan 1 2027.
  if (Date.now() > HIDE_AFTER) return null;

  return (
    <div className="w-full bg-gradient-to-r from-red-600 to-green-600 text-white text-center py-2 px-4 text-sm font-bold sticky top-0 z-50">
      🎄 Christmas Update in {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m{" "}
      {timeLeft.seconds}s — Nov 15! 🎅
    </div>
  );
};
