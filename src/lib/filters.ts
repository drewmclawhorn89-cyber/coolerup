export type CameraFilter = { id: string; name: string; css: string };

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

/** Safari doesn't support canvas ctx.filter, so filters can't be baked in there. */
export function canBakeFilters() {
  if (typeof document === "undefined") return false;
  const ctx = document.createElement("canvas").getContext("2d");
  return !!ctx && "filter" in ctx;
}
