import { useEffect, useRef, type RefObject } from "react";
import type { FaceBox } from "@/lib/animals";

type Detector = { detectForVideo: (v: HTMLVideoElement, t: number) => { detections: { boundingBox?: { originX: number; originY: number; width: number; height: number } }[] } };

let detectorPromise: Promise<Detector | null> | null = null;

function loadDetector() {
  detectorPromise ??= (async () => {
    try {
      const { FaceDetector, FilesetResolver } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm");
      const modelAssetPath = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";
      try {
        return (await FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath, delegate: "GPU" }, runningMode: "VIDEO" })) as unknown as Detector;
      } catch {
        return (await FaceDetector.createFromOptions(fileset, { baseOptions: { modelAssetPath }, runningMode: "VIDEO" })) as unknown as Detector;
      }
    } catch {
      detectorPromise = null;
      return null;
    }
  })();
  return detectorPromise;
}

/** Tracks the largest face in the video while `active`; the latest box (video pixels) is kept in the returned ref. */
export function useFaceTracker(videoRef: RefObject<HTMLVideoElement | null>, active: boolean) {
  const faceRef = useRef<FaceBox | null>(null);
  useEffect(() => {
    if (!active) {
      faceRef.current = null;
      return;
    }
    let stop = false;
    let raf = 0;
    let lastTs = -1;
    loadDetector().then((det) => {
      if (!det || stop) return;
      const tick = () => {
        if (stop) return;
        const v = videoRef.current;
        if (v && v.readyState >= 2 && v.videoWidth && v.currentTime !== lastTs) {
          lastTs = v.currentTime;
          try {
            const boxes = det.detectForVideo(v, performance.now()).detections.map((d) => d.boundingBox).filter(Boolean);
            const b = boxes.sort((a, c) => c!.width - a!.width)[0];
            if (b) {
              const cx = b.originX + b.width / 2;
              const cy = b.originY + b.height / 2;
              const prev = faceRef.current;
              const k = prev ? 0.5 : 1; // light smoothing
              faceRef.current = prev
                ? { cx: prev.cx + (cx - prev.cx) * k, cy: prev.cy + (cy - prev.cy) * k, w: prev.w + (b.width - prev.w) * k, at: performance.now() }
                : { cx, cy, w: b.width, at: performance.now() };
            }
          } catch {
            /* ignore frame errors */
          }
        }
        raf = requestAnimationFrame(tick);
      };
      tick();
    });
    return () => {
      stop = true;
      cancelAnimationFrame(raf);
      faceRef.current = null;
    };
  }, [videoRef, active]);
  return faceRef;
}
