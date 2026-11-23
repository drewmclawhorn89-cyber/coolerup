/** On-device OCR of the actual video pixels, never filenames or uploader claims. */
export type WatermarkReading = { text: string; confidence: number };

export function hasExistingWatermark(readings: readonly WatermarkReading[]): boolean {
  const handles = new Map<string, number>();
  for (const reading of readings) {
    if (reading.confidence < 40) continue;
    const text = reading.text.toLowerCase();
    const compact = text.replace(/\s+/g, "");
    if (/\b(tik\s*tok|instagram|youtube|snapchat|facebook|twitter|pinterest|reddit|kwai|kuaishou|douyin|triller|likee|vimeo|coolerup)\b/i.test(text) ||
        /(?:tiktok|instagram|youtube|snapchat|facebook|twitter|pinterest|reddit|kwai|douyin|triller|likee|vimeo)\.com\b/.test(compact)) return true;
    // An unfamiliar service/creator stamp must recur on different sampled frames.
    // One incidental caption containing an @mention is not enough.
    const unique = new Set(text.match(/@[a-z0-9_][a-z0-9_.]{2,29}/g) ?? []);
    for (const handle of unique) {
      const count = (handles.get(handle) ?? 0) + 1;
      handles.set(handle, count);
      if (count >= 2) return true;
    }
  }
  return false;
}

export function watermarkSampleTimes(duration: number): number[] {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Cannot inspect this video");
  const end = Math.max(0, duration - 0.1);
  return [...new Set([Math.min(0.15, end), Math.min(3.3, end), Math.min(6.3, end), duration / 2, end])];
}

function waitForVideo(video: HTMLVideoElement, event: string, action: () => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      video.removeEventListener(event, ready);
      video.removeEventListener("error", failed);
    };
    const ready = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Cannot read video for watermark detection")); };
    const timer = setTimeout(failed, 15_000);
    video.addEventListener(event, ready, { once: true });
    video.addEventListener("error", failed, { once: true });
    action();
  });
}

/** Reads corner stamps at multiple points, including moving watermarks. OCR is
 * deliberately lazy/browser-only. Unreadable media fails closed, not a raw export.
 * Logo-only, faint, or unusual marks can escape OCR; this is not provenance proof.
 */
export async function detectExistingVideoWatermark(
  blob: Blob,
  onProgress?: (progress: { percent: number; stage: string }) => void,
): Promise<boolean> {
  const { createWorker, PSM } = await import("tesseract.js");
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  const url = URL.createObjectURL(blob);
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  try {
    onProgress?.({ percent: 1, stage: "Checking existing watermark" });
    await waitForVideo(video, "loadeddata", () => { video.src = url; video.load(); });
    const times = watermarkSampleTimes(video.duration);
    if (!video.videoWidth || !video.videoHeight) throw new Error("Video has no readable frames");
    worker = await createWorker("eng", 1, {
      workerPath: new URL("/watermark-ocr/worker.min.js", window.location.origin).href,
      corePath: new URL("/watermark-ocr/tesseract-core-lstm.wasm.js", window.location.origin).href,
      langPath: new URL("/watermark-ocr/", window.location.origin).href,
      workerBlobURL: false,
    });
    await worker.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");
    // Four corner crops in a single OCR image, enlarged for small handle text.
    const cw = video.videoWidth * 0.45;
    const ch = video.videoHeight * 0.23;
    const scale = 600 / cw;
    const tileHeight = Math.round(ch * scale);
    canvas.width = 1200;
    canvas.height = tileHeight * 2;
    const readings: WatermarkReading[] = [];
    for (const [index, time] of times.entries()) {
      if (Math.abs(video.currentTime - time) > 0.01) {
        await waitForVideo(video, "seeked", () => { video.currentTime = time; });
      }
      for (let corner = 0; corner < 4; corner++) {
        const right = corner % 2 === 1;
        const bottom = corner >= 2;
        ctx.drawImage(video, right ? video.videoWidth - cw : 0, bottom ? video.videoHeight - ch : 0,
          cw, ch, right ? 600 : 0, bottom ? tileHeight : 0, 600, tileHeight);
      }
      const { data } = await worker.recognize(canvas);
      readings.push({ text: data.text, confidence: data.confidence });
      onProgress?.({ percent: Math.round(((index + 1) / times.length) * 4), stage: "Checking existing watermark" });
      if (hasExistingWatermark(readings)) return true;
    }
    return false;
  } finally {
    await worker?.terminate();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}