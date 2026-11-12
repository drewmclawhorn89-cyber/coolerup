/**
 * Christmas camera filters: Santa hat, reindeer nose, snow.
 *
 * These are drawn with canvas primitives (not emoji) so they scale with the
 * tracked face and bake into the recorded video exactly like the animal
 * filters do. `drawChristmasEffect` is used by both the live preview
 * (<ChristmasOverlay />) and the recorder's offscreen canvas.
 */
import { FACE_STALE_MS, type FaceBox } from "@/lib/animals";

export type ChristmasEffectId = "santa-hat" | "reindeer-nose" | "snow";

export type ChristmasEffect = {
  id: ChristmasEffectId;
  name: string;
  icon: string;
};

export const CHRISTMAS_EFFECTS: ChristmasEffect[] = [
  { id: "santa-hat", name: "Santa hat", icon: "🎅" },
  { id: "reindeer-nose", name: "Reindeer nose", icon: "🦌" },
  { id: "snow", name: "Snow", icon: "❄️" },
];

export function getChristmasEffect(id: string): ChristmasEffect | null {
  return CHRISTMAS_EFFECTS.find((e) => e.id === id) ?? null;
}

/** True when the effect needs a tracked face (snow doesn't). */
export function needsFace(id: ChristmasEffectId): boolean {
  return id !== "snow";
}

function drawSantaHat(ctx: CanvasRenderingContext2D, face: FaceBox) {
  const { cx, cy, w } = face;
  const brimY = cy - 0.46 * w;
  const brimW = 1.06 * w;
  const brimH = 0.17 * w;

  ctx.save();
  ctx.translate(cx, brimY);
  ctx.rotate(-0.08);

  // Cone of the hat, flopping to the right.
  ctx.beginPath();
  ctx.moveTo(-0.5 * w, 0);
  ctx.quadraticCurveTo(-0.2 * w, -0.72 * w, 0.6 * w, -0.58 * w);
  ctx.quadraticCurveTo(0.16 * w, -0.24 * w, 0.5 * w, 0);
  ctx.closePath();
  ctx.fillStyle = "#d81b1b";
  ctx.fill();
  // A darker fold so the cone reads as fabric, not a flat triangle.
  ctx.beginPath();
  ctx.moveTo(0.5 * w, 0);
  ctx.quadraticCurveTo(0.16 * w, -0.24 * w, 0.6 * w, -0.58 * w);
  ctx.quadraticCurveTo(0.42 * w, -0.28 * w, 0.24 * w, 0);
  ctx.closePath();
  ctx.fillStyle = "rgba(120, 8, 8, 0.45)";
  ctx.fill();

  // White fur brim.
  const r = brimH / 2;
  ctx.beginPath();
  ctx.roundRect(-brimW / 2, -brimH / 2, brimW, brimH, r);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-brimW / 2, 0, brimW, brimH * 0.35, r);
  ctx.fillStyle = "rgba(203, 213, 225, 0.55)";
  ctx.fill();

  // Pom-pom on the tip.
  ctx.beginPath();
  ctx.arc(0.62 * w, -0.6 * w, 0.15 * w, 0, Math.PI * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0.58 * w, -0.64 * w, 0.07 * w, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(226, 232, 240, 0.9)";
  ctx.fill();

  ctx.restore();
}

function drawReindeerNose(ctx: CanvasRenderingContext2D, face: FaceBox) {
  const { cx, cy, w } = face;
  const noseY = cy + 0.13 * w;
  const r = 0.115 * w;

  // Antlers behind the head.
  ctx.save();
  ctx.strokeStyle = "#7c4a21";
  ctx.lineWidth = Math.max(2, 0.045 * w);
  ctx.lineCap = "round";
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * 0.28 * w, cy - 0.36 * w);
    ctx.lineTo(cx + dir * 0.34 * w, cy - 0.66 * w);
    ctx.moveTo(cx + dir * 0.32 * w, cy - 0.54 * w);
    ctx.lineTo(cx + dir * 0.48 * w, cy - 0.62 * w);
    ctx.moveTo(cx + dir * 0.31 * w, cy - 0.46 * w);
    ctx.lineTo(cx + dir * 0.47 * w, cy - 0.46 * w);
    ctx.stroke();
  }
  ctx.restore();

  // Glowing red nose.
  ctx.save();
  ctx.shadowColor = "rgba(255, 40, 40, 0.95)";
  ctx.shadowBlur = 0.3 * w;
  ctx.beginPath();
  ctx.arc(cx, noseY, r, 0, Math.PI * 2);
  ctx.fillStyle = "#ff2b2b";
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, noseY - r * 0.35, r * 0.35, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255, 255, 255, 0.75)";
  ctx.fill();
  ctx.restore();
}

/** Deterministic pseudo-random so flakes don't jitter between frames. */
function rand(seed: number): number {
  const x = Math.sin(seed * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

const FLAKES = 60;

function drawSnow(ctx: CanvasRenderingContext2D, width: number, height: number, time: number) {
  const t = time / 1000;
  ctx.save();
  ctx.fillStyle = "#ffffff";
  for (let i = 0; i < FLAKES; i++) {
    const speed = 18 + rand(i + 1) * 42; // px per second
    const size = 1.2 + rand(i + 91) * 2.6;
    const drift = Math.sin(t * 0.7 + i) * 12;
    const x = rand(i + 11) * width + drift;
    const y = (rand(i + 37) * height + t * speed) % (height + 12);
    ctx.globalAlpha = 0.45 + rand(i + 53) * 0.5;
    ctx.beginPath();
    ctx.arc(x, y - 6, size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Draw one Christmas effect.
 *
 * `face` is in destination-canvas coordinates (already mirrored/scaled by the
 * caller). Snow ignores it and covers the whole frame.
 */
export function drawChristmasEffect(
  ctx: CanvasRenderingContext2D,
  effect: ChristmasEffect | null,
  face: FaceBox | null,
  frame?: { width: number; height: number; time?: number },
) {
  if (!effect) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if ("filter" in ctx) ctx.filter = "none";

  if (effect.id === "snow") {
    drawSnow(
      ctx,
      frame?.width ?? ctx.canvas.width,
      frame?.height ?? ctx.canvas.height,
      frame?.time ?? performance.now(),
    );
  } else if (face && performance.now() - face.at <= FACE_STALE_MS) {
    if (effect.id === "santa-hat") drawSantaHat(ctx, face);
    else if (effect.id === "reindeer-nose") drawReindeerNose(ctx, face);
  }

  ctx.restore();
}
