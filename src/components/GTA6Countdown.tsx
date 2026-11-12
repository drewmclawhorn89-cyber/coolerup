import { useEffect, useState } from "react";

import { GTA6_END, GTA6_PINK, GTA6_PURPLE, gta6TimeLeft, type GTA6TimeLeft } from "@/lib/gta6";

/**
 * Live countdown to the end of the GTA 6 event (Nov 15 2026 23:59:59 local).
 *
 * Ticks once a second while the event is running, then renders "Event ended" and
 * stops. The first paint is seeded from the real clock so there is no
 * one-frame "0d 0h 0m" flash.
 */
export function GTA6Countdown({
  className = "",
  compact = false,
}: {
  className?: string;
  /** Compact renders a single line, e.g. for the banner. */
  compact?: boolean;
}) {
  const [left, setLeft] = useState<GTA6TimeLeft>(() => gta6TimeLeft());
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const tick = () => {
      const next = gta6TimeLeft();
      setLeft(next);
      return !next.ended;
    };
    if (!tick()) return;
    const timer = window.setInterval(() => {
      if (!tick()) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  // Keep the server render and the first client render identical.
  if (!mounted) {
    return (
      <span className={className} aria-hidden>
        &nbsp;
      </span>
    );
  }

  if (left.ended) {
    return (
      <span className={className} role="status">
        Event ended
      </span>
    );
  }

  if (compact) {
    return (
      <span className={className} role="timer" aria-live="off">
        {left.days > 0 ? (
          <>
            <strong>{left.days}</strong> {left.days === 1 ? "day" : "days"}{" "}
            <strong>{left.hours}</strong>h <strong>{left.minutes}</strong>m left
          </>
        ) : (
          <>
            <strong>{left.hours}</strong>h <strong>{left.minutes}</strong>m{" "}
            <strong>{left.seconds}</strong>s left
          </>
        )}
      </span>
    );
  }

  const cells: { value: number; label: string }[] = [
    { value: left.days, label: left.days === 1 ? "day" : "days" },
    { value: left.hours, label: "hrs" },
    { value: left.minutes, label: "min" },
    { value: left.seconds, label: "sec" },
  ];

  return (
    <div className={`flex items-center gap-1.5 ${className}`} role="timer" aria-live="off">
      {cells.map((cell, i) => (
        <div key={cell.label} className="flex items-center gap-1.5">
          <div
            className="gta6-countdown-cell flex min-w-[2.6rem] flex-col items-center rounded-lg px-1.5 py-1"
            style={{ borderColor: `${GTA6_PINK}66` }}
          >
            <span className="font-display text-base font-bold leading-none tabular-nums text-white">
              {String(cell.value).padStart(2, "0")}
            </span>
            <span
              className="mt-0.5 text-[8px] font-bold uppercase leading-none tracking-widest"
              style={{ color: GTA6_PURPLE }}
            >
              {cell.label}
            </span>
          </div>
          {i < cells.length - 1 && (
            <span className="text-xs font-bold" style={{ color: GTA6_PINK }} aria-hidden>
              :
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

/** Milliseconds until the event closes, clamped at 0. Handy for tests. */
export function gta6MsLeft(now: Date = new Date()): number {
  return Math.max(0, GTA6_END.getTime() - now.getTime());
}
