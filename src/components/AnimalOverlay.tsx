import { useEffect, useRef, type RefObject } from "react";
import { drawAnimal, type AnimalFilter, type FaceBox } from "@/lib/animals";

/** Live preview: draws the animal on a canvas over the (object-cover) video, following the tracked face. */
export function AnimalOverlay({
  animal,
  videoRef,
  faceRef,
  mirror,
}: {
  animal: AnimalFilter | null;
  videoRef: RefObject<HTMLVideoElement | null>;
  faceRef: RefObject<FaceBox | null>;
  mirror: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!animal) return;
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
        const f = faceRef.current;
        if (f && v.videoWidth) {
          const s = Math.max(cw / v.videoWidth, ch / v.videoHeight);
          const x = f.cx * s + (cw - v.videoWidth * s) / 2;
          drawAnimal(ctx, animal, { cx: mirror ? cw - x : x, cy: f.cy * s + (ch - v.videoHeight * s) / 2, w: f.w * s, at: f.at });
        }
      }
      raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [animal, videoRef, faceRef, mirror]);
  if (!animal) return null;
  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden />;
}
