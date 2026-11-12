export type CameraFilter = { id: string; name: string; css: string };

/**
 * The GTA 6 event filter. Defined here (not in the component) so the pure
 * catalogue stays importable from tests and non-React code. The component file
 * re-exports it for convenience.
 */
export const GTA6_CAMERA_FILTER: CameraFilter = {
  id: "gta6",
  name: "GTA 6",
  css: "saturate(1.85) contrast(1.18) hue-rotate(-16deg) brightness(1.06) sepia(0.14)",
};

export const CAMERA_FILTERS: CameraFilter[] = [
  { id: "none", name: "Normal", css: "none" },
  { id: "vivid", name: "Vivid", css: "saturate(1.6) contrast(1.1)" },
  { id: "warm", name: "Warm", css: "sepia(0.35) saturate(1.3) hue-rotate(-10deg)" },
  { id: "cool", name: "Cool", css: "saturate(1.1) hue-rotate(15deg) brightness(1.05)" },
  { id: "mono", name: "Mono", css: "grayscale(1) contrast(1.15)" },
  { id: "vintage", name: "Vintage", css: "sepia(0.7) contrast(0.9) brightness(1.1)" },
  { id: "fade", name: "Fade", css: "contrast(0.85) brightness(1.15) saturate(0.8)" },
  { id: "noir", name: "Noir", css: "grayscale(1) contrast(1.5) brightness(0.9)" },
  { id: "pop", name: "Pop", css: "saturate(2) contrast(1.2) hue-rotate(340deg)" },
];

/**
 * Filters available right now. The GTA 6 filter only appears during the event,
 * so it vanishes for good after Nov 15 2026.
 */
export function filtersForMode(gta6: boolean): CameraFilter[] {
  return gta6 ? [...CAMERA_FILTERS, GTA6_CAMERA_FILTER] : CAMERA_FILTERS;
}

/** Look up a filter by id, falling back to Normal. */
export function filterById(id: string, gta6 = false): CameraFilter {
  return filtersForMode(gta6).find((f) => f.id === id) ?? CAMERA_FILTERS[0]!;
}

/** Safari doesn't support canvas ctx.filter, so filters can't be baked in there. */
export function canBakeFilters() {
  if (typeof document === "undefined") return false;
  const ctx = document.createElement("canvas").getContext("2d");
  return !!ctx && "filter" in ctx;
}
