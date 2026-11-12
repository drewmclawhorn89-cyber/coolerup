/**
 * Deterministic confetti scatter for the first-follower celebration.
 *
 * Kept out of the component file so the modal stays a pure component module
 * (React Fast Refresh only works that way) and so the maths is unit testable.
 */
export type ConfettiPiece = {
  left: number;
  delay: number;
  duration: number;
  size: number;
  color: string;
  rotate: number;
  drift: number;
};

export const CONFETTI_COLORS = ["#fe2c55", "#25f4ee", "#ffd400", "#ffffff", "#a855f7", "#22c55e"];

/**
 * A stable pseudo-random scatter. `seed` makes the layout reproducible so the
 * burst doesn't reshuffle on every re-render, and tests can assert on it.
 */
export function confettiPieces(count = 60, seed = 7): ConfettiPiece[] {
  const pieces: ConfettiPiece[] = [];
  let state = seed * 9301 + 49297;
  const next = () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };
  for (let i = 0; i < count; i += 1) {
    pieces.push({
      left: next() * 100,
      delay: next() * 1.2,
      duration: 2.4 + next() * 2.2,
      size: 6 + next() * 8,
      color: CONFETTI_COLORS[Math.floor(next() * CONFETTI_COLORS.length)] ?? "#fe2c55",
      rotate: next() * 360,
      drift: (next() - 0.5) * 120,
    });
  }
  return pieces;
}
