/** A tracked face box in video pixel coordinates (cx/cy = center, w = width). */
export type FaceBox = { cx: number; cy: number; w: number; at: number };
/** Emoji anchored to the face: dx/dy are offsets from face center and size is the emoji size, both in face widths. */
export type AnimalPart = { emoji: string; dx: number; dy: number; size: number };
export type AnimalFilter = { id: string; name: string; icon: string; parts: AnimalPart[] };

const top = (emoji: string): AnimalPart => ({ emoji, dx: 0, dy: -0.8, size: 0.75 });

export const ANIMAL_FILTERS: AnimalFilter[] = [
  { id: "dog", name: "Dog", icon: "🐶", parts: [top("🐶"), { emoji: "👃", dx: 0, dy: 0.12, size: 0.3 }, { emoji: "👅", dx: 0, dy: 0.45, size: 0.3 }] },
  { id: "cat", name: "Cat", icon: "🐱", parts: [top("🐱"), { emoji: "🐾", dx: 0, dy: 0.15, size: 0.3 }] },
  { id: "bunny", name: "Bunny", icon: "🐰", parts: [top("🐰"), { emoji: "🥕", dx: 0.45, dy: 0.5, size: 0.3 }] },
  { id: "fox", name: "Fox", icon: "🦊", parts: [top("🦊"), { emoji: "🐾", dx: 0, dy: 0.15, size: 0.3 }] },
  { id: "panda", name: "Panda", icon: "🐼", parts: [top("🐼"), { emoji: "🎋", dx: 0.5, dy: 0.5, size: 0.35 }] },
  { id: "lion", name: "Lion", icon: "🦁", parts: [top("🦁"), { emoji: "👑", dx: 0, dy: -1.35, size: 0.45 }] },
  { id: "frog", name: "Frog", icon: "🐸", parts: [top("🐸"), { emoji: "👅", dx: 0, dy: 0.45, size: 0.3 }] },
];

export function getAnimal(id: string) {
  return ANIMAL_FILTERS.find((a) => a.id === id) ?? null;
}

export const FACE_STALE_MS = 600;

/** Draw the animal anchored to `face` (already in destination canvas coordinates). Does nothing without a fresh face. */
export function drawAnimal(ctx: CanvasRenderingContext2D, animal: AnimalFilter | null, face: FaceBox | null) {
  if (!animal || !face || performance.now() - face.at > FACE_STALE_MS) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if ("filter" in ctx) ctx.filter = "none";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of animal.parts) {
    ctx.font = `${Math.max(8, Math.round(p.size * face.w))}px sans-serif`;
    ctx.fillText(p.emoji, face.cx + p.dx * face.w, face.cy + p.dy * face.w);
  }
  ctx.restore();
}

/** Map a video-space face to a destination of the given size (optionally mirrored horizontally). */
export function mirrorFace(face: FaceBox, videoWidth: number): FaceBox {
  return { ...face, cx: videoWidth - face.cx };
}
