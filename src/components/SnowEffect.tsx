import { useEffect, useMemo, useState } from "react";
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

/** Deterministic [0, 1) value for a given flake seed so SSR/client stay consistent. */
function seeded(index: number, salt: number): number {
  const x = Math.sin((index + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * 50 light white dots falling over the app — only while the Christmas update is
 * live (Nov 15 2026 -> Jan 1 2027). Purely decorative: pointer-events-none,
 * aria-hidden, and hidden for anyone who prefers reduced motion (CSS).
 */
export function SnowEffect() {
  const christmas = useChristmasMode();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const flakes = useMemo<Flake[]>(
    () =>
      Array.from({ length: FLAKE_COUNT }, (_, i) => ({
        left: seeded(i, 1) * 100,
        size: 2 + seeded(i, 2) * 3,
        delay: -seeded(i, 3) * 14,
        duration: 7 + seeded(i, 4) * 8,
        drift: (seeded(i, 5) * 2 - 1) * 36,
        opacity: 0.35 + seeded(i, 6) * 0.5,
      })),
    [],
  );

  if (!mounted || !christmas) return null;

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
