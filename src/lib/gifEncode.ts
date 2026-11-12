/**
 * Pure-browser GIF encoder (no WebAssembly).
 *
 * ffmpeg.wasm is a ~30 MB download that needs a same-origin wasm blob and a
 * generous heap. On phones — especially iOS Safari — it routinely fails to
 * load or dies mid-encode, which is why "GIF conversion failed on this device"
 * kept showing up. This path instead decodes the clip with the browser's own
 * `<video>` element, paints each frame onto a canvas, and encodes the result
 * with `gifenc` (a ~5 KB dependency-free GIF writer).
 *
 * It handles trim, speed, square crop and the text/sticker overlay entirely in
 * canvas, so it needs nothing from the network and works anywhere the video
 * itself can play. `convertVideoToGif` in lib/gif.ts tries this first and only
 * falls back to ffmpeg when the browser cannot decode the file at all.
 */

import { GIFEncoder, applyPalette, quantize } from "gifenc";
import {
  MAX_GIF_BYTES,
  MAX_GIF_SECONDS,
  MIN_GIF_SECONDS,
  type GifEdit,
  type GifResult,
} from "@/lib/gif";

/** Frame rates tried in order; lower fps means a smaller file. */
const FPS_STEPS = [12, 10, 8] as const;

/** Long-edge sizes tried in order. */
const SIZE_STEPS = [480, 400, 320] as const;

/** Colour counts tried in order. */
const COLOR_STEPS = [256, 128, 64] as const;

/** Hard ceiling so a slow phone never spends minutes on one GIF. */
const MAX_FRAMES = 40;

function waitFor(el: HTMLVideoElement, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      el.removeEventListener(event, onEvent);
      el.removeEventListener("error", onError);
      if (err) reject(err);
      else resolve();
    };
    const onEvent = () => finish();
    const onError = () => finish(new Error("This browser can't decode that video."));
    el.addEventListener(event, onEvent, { once: true });
    el.addEventListener("error", onError, { once: true });
    window.setTimeout(() => finish(), timeoutMs);
  });
}

/** Load a File into a muted, inline <video> and wait for its metadata. */
async function openVideo(file: File): Promise<{ video: HTMLVideoElement; url: string }> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.src = url;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");

  await waitFor(video, "loadedmetadata", 12_000);
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    // Some browsers report Infinity until the first frame is decoded.
    await waitFor(video, "loadeddata", 8_000);
  }
  if (!Number.isFinite(video.duration) || video.duration <= 0) {
    URL.revokeObjectURL(url);
    throw new Error("Couldn't read that video's length.");
  }
  return { video, url };
}

/** Seek and resolve once the frame is actually painted. */
async function seek(video: HTMLVideoElement, time: number): Promise<void> {
  const target = Math.max(0, Math.min(time, Math.max(0, video.duration - 0.02)));
  if (Math.abs(video.currentTime - target) < 0.001) return;
  video.currentTime = target;
  await waitFor(video, "seeked", 2_500);
}

async function loadOverlay(blob: Blob | null | undefined): Promise<ImageBitmap | null> {
  if (!blob || blob.size === 0) return null;
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/** Crop box that turns the source into a centred square (or keeps its shape). */
function cropBox(vw: number, vh: number, square: boolean) {
  if (!square) return { sx: 0, sy: 0, sw: vw, sh: vh };
  const side = Math.min(vw, vh);
  return { sx: (vw - side) / 2, sy: (vh - side) / 2, sw: side, sh: side };
}

/**
 * Turn a video file into a GIF using canvas + gifenc.
 *
 * Throws with a human-readable message when the browser cannot decode the
 * source; the caller then falls back to ffmpeg.
 */
export async function convertVideoToGifCanvas(
  file: File,
  edit: GifEdit,
  onProgress?: (percent: number, stage: string) => void,
): Promise<GifResult> {
  const start = Math.max(0, edit.start);
  const requested = Math.max(MIN_GIF_SECONDS, edit.end - start);
  const speed = edit.speed;
  const sourceDuration = Math.min(requested, MAX_GIF_SECONDS * speed);
  if (sourceDuration < MIN_GIF_SECONDS) {
    throw new Error("Pick at least half a second of video.");
  }

  onProgress?.(4, "Opening video");
  const { video, url } = await openVideo(file);
  const overlay = await loadOverlay(edit.overlay);

  try {
    const vw = video.videoWidth || 480;
    const vh = video.videoHeight || 480;
    const box = cropBox(vw, vh, edit.cropSquare);
    const outputDuration = sourceDuration / speed;
    let lastError: Error | null = null;

    for (const fps of FPS_STEPS) {
      const frameCount = Math.max(2, Math.min(MAX_FRAMES, Math.round(outputDuration * fps)));
      const delay = Math.round(1000 / fps);

      for (const size of SIZE_STEPS) {
        // Fit the crop box into `size` on its long edge.
        const scale = size / Math.max(box.sw, box.sh);
        const outW = Math.max(2, Math.round(box.sw * scale));
        const outH = Math.max(2, Math.round(box.sh * scale));

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("This browser can't draw video frames.");
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        for (const colors of COLOR_STEPS) {
          const gif = GIFEncoder();

          try {
            for (let i = 0; i < frameCount; i++) {
              // Frame i of the output is source time start + i * speed / fps.
              const t = start + (i * speed) / fps;
              await seek(video, t);

              ctx.fillStyle = "#000";
              ctx.fillRect(0, 0, outW, outH);
              ctx.drawImage(video, box.sx, box.sy, box.sw, box.sh, 0, 0, outW, outH);
              if (overlay) ctx.drawImage(overlay, 0, 0, outW, outH);

              const { data } = ctx.getImageData(0, 0, outW, outH);
              const rgba = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
              const palette = quantize(rgba, colors, { format: "rgb565" });
              const index = applyPalette(rgba, palette, "rgb565");
              gif.writeFrame(index, outW, outH, { palette, delay });

              onProgress?.(
                Math.min(
                  95,
                  Math.round(((i + 1) / frameCount) * (colors === COLOR_STEPS[0] ? 70 : 85) + 10),
                ),
                colors === COLOR_STEPS[0] ? "Making GIF" : "Shrinking GIF",
              );
            }

            gif.finish();
            const bytes = gif.bytes();
            if (bytes.byteLength === 0) throw new Error("The GIF came out empty.");

            const blob = new Blob([bytes as unknown as BlobPart], { type: "image/gif" });
            if (blob.size > MAX_GIF_BYTES) {
              lastError = new Error("GIF is over 5 MB.");
              continue;
            }

            onProgress?.(100, "Done");
            return { blob, width: outW, height: outH, duration: outputDuration };
          } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            // A decode failure will not be fixed by fewer colours.
            if (/decode|empty/i.test(lastError.message)) throw lastError;
          }
        }
      }
    }

    throw lastError ?? new Error("Couldn't fit this clip under 5 MB.");
  } finally {
    overlay?.close();
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}
