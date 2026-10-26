/** Emoji sticker placed in normalized frame coordinates (x/y = center, size = fraction of width). */
export type AnimalPart = { emoji: string; x: number; y: number; size: number };
export type AnimalFilter = { id: string; name: string; icon: string; parts: AnimalPart[] };

export const ANIMAL_FILTERS: AnimalFilter[] = [
  { id: "dog", name: "Dog", icon: "🐶", parts: [{ emoji: "🐶", x: 0.5, y: 0.2, size: 0.22 }, { emoji: "👅", x: 0.5, y: 0.52, size: 0.12 }] },
  { id: "cat", name: "Cat", icon: "🐱", parts: [{ emoji: "🐱", x: 0.5, y: 0.2, size: 0.22 }, { emoji: "🐾", x: 0.5, y: 0.45, size: 0.1 }] },
  { id: "bunny", name: "Bunny", icon: "🐰", parts: [{ emoji: "🐰", x: 0.5, y: 0.2, size: 0.22 }, { emoji: "🥕", x: 0.5, y: 0.55, size: 0.1 }] },
  { id: "fox", name: "Fox", icon: "🦊", parts: [{ emoji: "🦊", x: 0.5, y: 0.2, size: 0.22 }] },
  { id: "panda", name: "Panda", icon: "🐼", parts: [{ emoji: "🐼", x: 0.5, y: 0.2, size: 0.22 }, { emoji: "🎋", x: 0.5, y: 0.55, size: 0.1 }] },
  { id: "lion", name: "Lion", icon: "🦁", parts: [{ emoji: "🦁", x: 0.5, y: 0.2, size: 0.22 }, { emoji: "👑", x: 0.5, y: 0.07, size: 0.12 }] },
  { id: "frog", name: "Frog", icon: "🐸", parts: [{ emoji: "🐸", x: 0.5, y: 0.2, size: 0.22 }] },
];

export function getAnimal(id: string) {
  return ANIMAL_FILTERS.find((a) => a.id === id) ?? null;
}

/** Draw the animal stickers onto a canvas, ignoring any current filter/transform. */
export function drawAnimal(ctx: CanvasRenderingContext2D, w: number, h: number, animal: AnimalFilter | null) {
  if (!animal) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if ("filter" in ctx) ctx.filter = "none";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const p of animal.parts) {
    ctx.font = `${Math.round(p.size * w)}px sans-serif`;
    ctx.fillText(p.emoji, p.x * w, p.y * h);
  }
  ctx.restore();
}
