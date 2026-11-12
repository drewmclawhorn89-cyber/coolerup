import { useEffect, useRef, type RefObject } from "react";
import type { FaceBox } from "@/lib/animals";
import { drawChristmasEffect, type ChristmasEffect } from "@/lib/christmas-effects";

/**
 * Live preview for the Christmas camera filters. Mirrors <AnimalOverlay />:
 * a transparent canvas sits over the (object-cover) camera video and redraws
 * the effect every frame, following the tracked face when the effect needs one.
 */
export function ChristmasOverlay({
  effect,
  videoRef,
  faceRef,
  mirror,
}: {
  effect: ChristmasEffect | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  faceRef: RefObject<FaceBox | null>;
  mirror: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!effect) return;
    let raf = 0;
    const loop = () => {
      const c = canvasRef.current;
      const v = videoRef.current;
      const ctx = c?.getContext("2d");
      if (c && v && ctx) {
        const cw = c.clientWidth;
        const ch = c.clientHeight;
        if (c.width !== cw || c.height !== ch) {
          c.width = cw;
          c.height = ch;
        }
        ctx.clearRect(0, 0, cw, ch);

        let face: FaceBox | null = null;
        const f = faceRef.current;
        if (f && v.videoWidth) {
          const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
          const x = f.cx * s + (cw - v.videoWidth * s) / 2;
          face = {
            cx: mirror ? cw - x : x,
            cy: f.cy * s + (ch - v.videoHeight * s) / 2,
            w: f.w * s,
            at: f.at,
          };
        }
        drawChristmasEffect(ctx, effect, face, { width: cw, height: ch });
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [effect, videoRef, faceRef, mirror]);

  if (!effect) return null;
  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 h-full w-full"
      aria-hidden
    />
  );
}
