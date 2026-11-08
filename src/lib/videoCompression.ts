/**
 * Client-side 720p compression for long uploads.
 *
 * A 10-minute 1080p phone video is routinely 400–600 MB. Sending that over a
 * mobile connection is the difference between "uploads in 2 minutes" and "sits
 * at 12% until the tab is closed". Re-encoding to 720p first cuts the file by
 * roughly 3× with no visible blur on a phone screen, so the upload finishes in
 * a third of the time and lands far below any storage cap.
 *
 * We use ffmpeg.wasm, loaded lazily from a CDN the first time it is needed, so
 * the main bundle stays small and short clips never pay for it. If the wasm
 * fails to load (offline, blocked CDN, out of memory) every function here
 * degrades to "return null", and the caller uploads the original file instead.
 * Compression must never be the reason an upload cannot happen.
 */

/** Only bother re-encoding videos longer than this. */
export const COMPRESS_MIN_DURATION_SECONDS = 60;

/** …and only when they are bigger than this. */
export const COMPRESS_MIN_BYTES = 50 * 1024 * 1024;

/**
 * Don't try to re-encode anything bigger than this. ffmpeg.wasm runs in a
 * 32-bit heap, so pulling a ~1 GB file into MEMFS alongside the encoder's
 * buffers is a recipe for an out-of-memory crash. Above this we upload the
 * original (still under the 1 GB bucket limit) rather than risk the tab.
 */
export const COMPRESS_MAX_BYTES = 900 * 1024 * 1024;

/** Long edge target. 720p is the "Lite mode" sweet spot: sharp, not huge. */
export const COMPRESS_TARGET_HEIGHT = 720;

/** True when a file is worth the (slow) re-encode. */
export function shouldCompress(file: File, durationSeconds: number): boolean {
  return (
    durationSeconds > COMPRESS_MIN_DURATION_SECONDS &&
    file.size > COMPRESS_MIN_BYTES &&
    file.size <= COMPRESS_MAX_BYTES
  );
}

export type CompressionProgress = {
  /** 0–100. */
  percent: number;
  /** Human-readable phase, e.g. "Encoding 720p". */
  stage: string;
};

type FfmpegLike = {
  load: (opts: { coreURL: string; wasmURL: string }) => Promise<void>;
  writeFile: (name: string, data: Uint8Array) => Promise<void>;
  readFile: (name: string) => Promise<Uint8Array | string>;
  deleteFile: (name: string) => Promise<void>;
  exec: (args: string[]) => Promise<number>;
  on: (event: "progress", cb: (e: { progress: number; time: number }) => void) => void;
  off: (event: "progress", cb: (e: { progress: number; time: number }) => void) => void;
  terminate: () => void;
};

let ffmpegPromise: Promise<FfmpegLike> | null = null;
let active: FfmpegLike | null = null;

/** CDN copy of the single-threaded core (no SharedArrayBuffer / COOP headers). */
const CORE_BASE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

async function loadFfmpeg(): Promise<FfmpegLike> {
  if (ffmpegPromise) return ffmpegPromise;

  ffmpegPromise = (async () => {
    const [{ FFmpeg }, { toBlobURL }] = await Promise.all([
      import("@ffmpeg/ffmpeg"),
      import("@ffmpeg/util"),
    ]);

    const ffmpeg = new FFmpeg() as unknown as FfmpegLike;
    // Blob URLs keep the wasm same-origin, which the single-thread core needs.
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${CORE_BASE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${CORE_BASE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);
    await ffmpeg.load({ coreURL, wasmURL });
    active = ffmpeg;
    return ffmpeg;
  })().catch((err) => {
    // Don't cache a failed load — a retry on the next upload should try again.
    ffmpegPromise = null;
    active = null;
    throw err;
  });

  return ffmpegPromise;
}

/** Kill an in-flight encode and drop the instance so the next call reloads. */
export function cancelCompression(): void {
  try {
    active?.terminate();
  } catch {
    /* already gone */
  }
  active = null;
  ffmpegPromise = null;
}

function extensionOf(name: string): string {
  const match = /\.[a-z0-9]+$/i.exec(name);
  return match ? match[0].toLowerCase() : ".mp4";
}

/**
 * Re-encode `file` to a 720p H.264 MP4.
 *
 * Returns the compressed `File`, or `null` when compression is not possible or
 * did not actually make the file smaller — in which case the caller should
 * upload the original. Never throws.
 */
export async function compressVideoTo720p(
  file: File,
  durationSeconds: number,
  onProgress: (progress: CompressionProgress) => void,
): Promise<File | null> {
  const inName = `in_${Date.now()}${extensionOf(file.name)}`;
  const outName = `out_${Date.now()}.mp4`;
  let ffmpeg: FfmpegLike | null = null;
  let handler: ((e: { progress: number; time: number }) => void) | null = null;

  try {
    onProgress({ percent: 0, stage: "Loading compressor" });
    ffmpeg = await loadFfmpeg();

    onProgress({ percent: 2, stage: "Reading video" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.writeFile(inName, bytes);

    handler = ({ progress, time }) => {
      // ffmpeg reports 0–1; NaN shows up before the first frame is decoded.
      // `time` is microseconds, so fall back to time/duration when progress
      // is missing.
      let ratio = Number.isFinite(progress) ? progress : 0;
      if (!Number.isFinite(progress) && durationSeconds > 0 && time > 0) {
        ratio = time / 1_000_000 / durationSeconds;
      }
      onProgress({
        percent: Math.min(99, Math.max(3, Math.round(Math.max(0, Math.min(1, ratio)) * 100))),
        stage: "Encoding 720p",
      });
    };
    ffmpeg.on("progress", handler);

    // scale=-2 keeps the aspect ratio and rounds the width to an even number
    // (H.264 requires it). `min(720,ih)` prevents upscaling a smaller source.
    const code = await ffmpeg.exec([
      "-i",
      inName,
      "-vf",
      "scale=-2:'min(720,ih)'",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-maxrate",
      "2500k",
      "-bufsize",
      "5000k",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outName,
    ]);

    // A non-zero exit means the encode failed (unsupported codec, no memory).
    if (code !== 0) return null;

    if (handler) ffmpeg.off("progress", handler);
    handler = null;

    onProgress({ percent: 99, stage: "Finalizing" });
    const data = await ffmpeg.readFile(outName);
    if (typeof data === "string") return null;

    const blob = new Blob([data as unknown as BlobPart], { type: "video/mp4" });
    // If the re-encode grew the file (already-efficient source), keep original.
    if (blob.size === 0 || blob.size >= file.size) return null;

    const baseName = file.name.replace(/\.[^.]+$/, "");
    const outFile = new File([blob], `${baseName}-720p.mp4`, {
      type: "video/mp4",
      lastModified: Date.now(),
    });

    onProgress({ percent: 100, stage: "Done" });
    return outFile;
  } catch {
    // Out of memory, unsupported codec, blocked CDN — all mean "upload the
    // original". A failed compression is a slower upload, not a failed one.
    return null;
  } finally {
    try {
      if (ffmpeg && handler) ffmpeg.off("progress", handler);
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => undefined);
        await ffmpeg.deleteFile(outName).catch(() => undefined);
      }
    } catch {
      /* cleanup is best-effort */
    }
  }
}

/** "≈3× smaller" style hint for the UI, based on the source size. */
export function compressionHint(file: File): string {
  const mb = file.size / (1024 * 1024);
  return `${mb.toFixed(0)} MB → about ${Math.max(1, Math.round(mb / 3))} MB at 720p`;
}
