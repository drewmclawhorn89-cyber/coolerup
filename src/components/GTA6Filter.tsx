import { GTA6_CAMERA_FILTER, type CameraFilter } from "@/lib/filters";
import { GTA6_ORANGE, GTA6_PINK, GTA6_PURPLE } from "@/lib/gta6";

/**
 * The GTA 6 camera filter — a neon Vice-City sunset look.
 *
 * Pushed saturation plus a magenta hue shift and a touch of warmth, so skin
 * tones stay readable while the scene goes full neon. It is only offered while
 * the event is live; `filtersForMode()` hides it afterwards.
 */
export const GTA6_FILTER: CameraFilter = GTA6_CAMERA_FILTER;

/** Sunset gradient used by the filter chip and the For You background. */
export const GTA6_GRADIENT = `linear-gradient(135deg, ${GTA6_PINK} 0%, ${GTA6_PURPLE} 55%, ${GTA6_ORANGE} 100%)`;

/**
 * A small neon swatch shown next to the filter name in the picker, so the GTA 6
 * option reads as an event filter rather than a plain CSS preset.
 */
export function GTA6FilterChip({ active = false }: { active?: boolean }) {
  return (
    <span
      className="inline-block size-3 rounded-full ring-1 ring-white/40"
      style={{ background: GTA6_GRADIENT }}
      aria-hidden
    />
  );
}
