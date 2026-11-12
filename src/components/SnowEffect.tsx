import { useMemo } from "react";
import { useChristmasMode } from "@/lib/christmas";

const FLAKE_COUNT = 50;

type Flake = {
  left: number;
  size: number;
  delay: number;
  duration: number;
  drift: number;
  opacity: number;
};

/**
 * 50 light white dots falling over the app — only while the Christmas update is
 * live (Nov 15 2026 -> Jan 1 2027). Purely decorative: pointer-events-none,
 * aria-hidden, and hidden for anyone who prefers reduced motion (CSS).
 */
export function SnowEffect() {
  const christmas = useChristmasMode();

  const flakes = useMemo<Flake[]>(
    () =>
      Array.from({ length: FLAKE_COUNT }, () => ({
        left: Math.random() * 100,
        size: 2 + Math.random() * 3,
        delay: -Math.random() * 14,
        duration: 7 + Math.random() * 8,
        drift: (Math.random() * 2 - 1) * 36,
        opacity: 0.35 + Math.random() * 0.5,
      })),
    [],
  );

  if (!christmas) return null;

  return (
    <div
      aria-hidden
      className="christmas-snow pointer-events-none fixed inset-0 z-[60] overflow-hidden"
    >
      {flakes.map((f, i) => (
        <span
          key={i}
          className="christmas-flake"
          style={{
            left: `${f.left}%`,
            width: `${f.size}px`,
            height: `${f.size}px`,
            opacity: f.opacity,
            animationDelay: `${f.delay}s`,
            animationDuration: `${f.duration}s`,
            ["--flake-drift" as string]: `${f.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
