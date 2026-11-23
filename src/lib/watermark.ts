/**
 * Forced watermarking for every Coolerup export.
 *
 * Every video or photo that leaves the app — a download, a share-sheet file, a
 * "save to camera roll" — is re-encoded here with the Coolerup logo and the
 * creator's `@username` burned into the bottom-right corner for the entire
 * duration of the clip.
 *
 * There is deliberately **no** flag, prop, setting or query parameter that can
 * turn this off. `prepareWatermarkedFile` is the only exported way to turn a
 * media blob into a downloadable file, and it always watermarks. If the mark
 * cannot be applied (no ffmpeg, out of memory, unsupported codec) it throws
 * `WatermarkError` and the caller must abort the download. Handing back an
 * unwatermarked file is never an option — a failed watermark is a failed
 * download, not a clean one.
 *
 * The watermark is drawn as a transparent PNG at export time (logo + handle)
 * and composited with ffmpeg's `overlay` filter, so no font files or drawtext
 * configuration are needed and the result is identical on every platform.
 */

import { loadFfmpeg, type FfmpegLike } from "./videoCompression";

/** Opacity of the burned-in mark. Semi-transparent, but always legible. */
export const WATERMARK_ALPHA = 0.62;

/** Margin from the right/bottom edge, as a fraction of the video's short side. */
export const WATERMARK_MARGIN_RATIO = 0.035;

/** Coolerup logo shipped in `public/`. */
export const WATERMARK_LOGO_SRC = "/icon-192-coolerup.png";

/** Thrown when a watermark could not be applied. Callers must abort. */
export class WatermarkError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "WatermarkError";
  }
}

/** The underlying reason, flattened to one line so the console shows something usable. */
export function watermarkCause(error: unknown): string {
  const cause = (error as { cause?: unknown })?.cause ?? error;
  if (cause instanceof Error) return cause.message || cause.name;
  if (typeof cause === "string") return cause;
  return "";
}

export type WatermarkProgress = {
  /** 0–100. */
  percent: number;
  /** Human-readable phase, e.g. "Watermarking". */
  stage: string;
};

/** The handle to burn in, normalised to a single leading "@". */
export function watermarkHandle(username: string | null | undefined): string {
  const raw = (username ?? "").trim().replace(/^@+/, "");
  return `@${raw || "coolerup"}`;
}

/** True when a MIME type / filename looks like a still image rather than video. */
export function isImageBlob(blob: Blob, filename?: string): boolean {
  if (blob.type.startsWith("image/")) return true;
  if (blob.type.startsWith("video/")) return false;
  return /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(filename ?? "");
}

/* -------------------------------------------------------------------------- */
/* Watermark artwork                                                          */
/* -------------------------------------------------------------------------- */

type LogoSource = CanvasImageSource | null;

let logoPromise: Promise<LogoSource> | null = null;

/** Load the Coolerup logo once. Resolves to `null` if it cannot be fetched. */
function loadLogo(): Promise<LogoSource> {
  if (logoPromise) return logoPromise;
  logoPromise = (async () => {
    if (typeof document === "undefined") return null;
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.decoding = "sync";
      img.src = WATERMARK_LOGO_SRC;
      await img.decode();
      return img;
    } catch {
      return null;
    }
  })();
  return logoPromise;
}

/**
 * Paint the watermark (logo + @handle) onto a transparent canvas sized for a
 * video of `videoWidth` × `videoHeight`.
 *
 * The artwork is returned as PNG bytes so ffmpeg can overlay it. Alpha is baked
 * in via `globalAlpha`, which keeps the composite cheap (a plain `overlay`)
 * instead of needing an extra `colorchannelmixer` pass.
 */
export async function buildWatermarkPng(
  videoWidth: number,
  videoHeight: number,
  username: string | null | undefined,
): Promise<Uint8Array> {
  if (typeof document === "undefined") {
    throw new WatermarkError("Watermarking needs a browser canvas");
  }
  const width = Math.max(2, Math.round(videoWidth) || 720);
  const height = Math.max(2, Math.round(videoHeight) || 1280);

  // Everything scales off the short side so a portrait clip and a landscape
  // clip get the same visual weight.
  const shortSide = Math.min(width, height);
  const markSize = Math.max(14, Math.round(shortSide * 0.075));
  const gap = Math.max(3, Math.round(markSize * 0.22));
  const fontSize = Math.max(11, Math.round(markSize * 0.62));
  const handle = watermarkHandle(username);

  const font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

  // Measure on a scratch context first so the canvas is exactly as wide as the
  // mark needs to be — a full-frame PNG would bloat MEMFS for no reason.
  const scratch = document.createElement("canvas");
  const measureCtx = scratch.getContext("2d");
  if (!measureCtx) throw new WatermarkError("Canvas 2D is unavailable");
  measureCtx.font = font;
  const textWidth = Math.ceil(measureCtx.measureText(handle).width);

  const pad = Math.max(2, Math.round(markSize * 0.12));
  const artWidth = pad * 2 + markSize + gap + textWidth;
  const artHeight = pad * 2 + markSize;

  const canvas = document.createElement("canvas");
  canvas.width = artWidth;
  canvas.height = artHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new WatermarkError("Canvas 2D is unavailable");

  ctx.clearRect(0, 0, artWidth, artHeight);
  ctx.globalAlpha = WATERMARK_ALPHA;

  // A soft dark halo keeps white text readable over bright frames without
  // changing the white fill the brand uses.
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = Math.max(2, Math.round(markSize * 0.18));
  ctx.shadowOffsetY = Math.max(1, Math.round(markSize * 0.04));

  const logo = await loadLogo();
  const logoX = pad;
  const logoY = pad;
  if (logo) {
    ctx.drawImage(logo, logoX, logoY, markSize, markSize);
  } else {
    // Fallback badge so the mark always carries a logo-shaped element.
    ctx.fillStyle = "#ffffff";
    const r = markSize * 0.28;
    ctx.beginPath();
    ctx.roundRect(logoX, logoY, markSize, markSize, r);
    ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.fillStyle = "#000000";
    ctx.font = `700 ${Math.round(markSize * 0.62)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("C", logoX + markSize / 2, logoY + markSize / 2 + markSize * 0.02);
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  }

  ctx.fillStyle = "#ffffff";
  ctx.font = font;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(handle, logoX + markSize + gap, logoY + markSize / 2 + fontSize * 0.03);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new WatermarkError("Could not render the watermark");
  return new Uint8Array(await blob.arrayBuffer());
}

/* -------------------------------------------------------------------------- */
/* Video                                                                      */
/* -------------------------------------------------------------------------- */

type VideoMeta = { width: number; height: number };

/** Read width/height from a `<video>` element without touching the DOM tree. */
async function probeVideo(blob: Blob): Promise<VideoMeta> {
  if (typeof document === "undefined") {
    throw new WatermarkError("Watermarking needs a browser");
  }
  const url = URL.createObjectURL(blob);
  const el = document.createElement("video");
  el.preload = "metadata";
  el.muted = true;
  el.playsInline = true;
  el.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      const done = () => resolve();
      const fail = () => reject(new WatermarkError("Could not read this video"));
      el.addEventListener("loadedmetadata", done, { once: true });
      el.addEventListener("error", fail, { once: true });
      // Some browsers never fire either event for a truncated file.
      setTimeout(fail, 15_000);
    });
    if (!el.videoWidth || !el.videoHeight) {
      throw new WatermarkError("Could not read this video's dimensions");
    }
    return { width: el.videoWidth, height: el.videoHeight };
  } finally {
    el.removeAttribute("src");
    el.load();
    URL.revokeObjectURL(url);
  }
}

/**
 * Burn the watermark into every frame of `blob` and return a new MP4.
 *
 * Always throws `WatermarkError` on failure — never returns the input.
 */
export async function watermarkVideoBlob(
  blob: Blob,
  username: string | null | undefined,
  onProgress?: (progress: WatermarkProgress) => void,
): Promise<Blob> {
  const { width, height } = await probeVideo(blob);
  onProgress?.({ percent: 5, stage: "Building watermark" });
  const png = await buildWatermarkPng(width, height, username);

  const margin = Math.max(8, Math.round(Math.min(width, height) * WATERMARK_MARGIN_RATIO));

  let ffmpeg: FfmpegLike | null = null;
  const stamp = Date.now();
  const inName = `wm_in_${stamp}.bin`;
  const pngName = `wm_mark_${stamp}.png`;
  const outName = `wm_out_${stamp}.mp4`;
  let handler: ((e: { progress: number; time: number }) => void) | null = null;

  try {
    onProgress?.({ percent: 12, stage: "Loading watermarker" });
    ffmpeg = await loadFfmpeg();

    await ffmpeg.writeFile(inName, new Uint8Array(await blob.arrayBuffer()));
    await ffmpeg.writeFile(pngName, png);

    handler = ({ progress }) => {
      const ratio = Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
      onProgress?.({
        percent: Math.min(98, Math.max(15, Math.round(15 + ratio * 83))),
        stage: "Watermarking",
      });
    };
    ffmpeg.on("progress", handler);

    const code = await ffmpeg.exec([
      "-i",
      inName,
      "-i",
      pngName,
      "-filter_complex",
      `[0:v][1:v]overlay=main_w-overlay_w-${margin}:main_h-overlay_h-${margin}:format=auto`,
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
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

    if (code !== 0) throw new WatermarkError("The watermark could not be applied to this video");

    if (handler) {
      ffmpeg.off("progress", handler);
      handler = null;
    }

    onProgress?.({ percent: 99, stage: "Finalizing" });
    const data = await ffmpeg.readFile(outName);
    if (typeof data === "string" || !data || data.length === 0) {
      throw new WatermarkError("The watermarked video came back empty");
    }

    onProgress?.({ percent: 100, stage: "Done" });
    return new Blob([data as unknown as BlobPart], { type: "video/mp4" });
  } catch (err) {
    if (err instanceof WatermarkError) throw err;
    throw new WatermarkError("The watermark could not be applied to this video", { cause: err });
  } finally {
    try {
      if (ffmpeg && handler) ffmpeg.off("progress", handler);
      if (ffmpeg) {
        await ffmpeg.deleteFile(inName).catch(() => undefined);
        await ffmpeg.deleteFile(pngName).catch(() => undefined);
        await ffmpeg.deleteFile(outName).catch(() => undefined);
      }
    } catch {
      /* cleanup is best-effort */
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Images                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Burn the watermark into a still image (photo posts). Same mark, same corner.
 * Always throws `WatermarkError` on failure — never returns the input.
 */
export async function watermarkImageBlob(
  blob: Blob,
  username: string | null | undefined,
): Promise<Blob> {
  if (typeof document === "undefined") {
    throw new WatermarkError("Watermarking needs a browser canvas");
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = "sync";
    img.src = url;
    await img.decode().catch(() => {
      throw new WatermarkError("Could not read this image");
    });

    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    if (!width || !height) throw new WatermarkError("Could not read this image's dimensions");

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new WatermarkError("Canvas 2D is unavailable");
    ctx.drawImage(img, 0, 0, width, height);

    const png = await buildWatermarkPng(width, height, username);
    const markUrl = URL.createObjectURL(
      new Blob([png as unknown as BlobPart], { type: "image/png" }),
    );
    try {
      const mark = new Image();
      mark.decoding = "sync";
      mark.src = markUrl;
      await mark.decode().catch(() => {
        throw new WatermarkError("Could not render the watermark");
      });
      const margin = Math.max(6, Math.round(Math.min(width, height) * WATERMARK_MARGIN_RATIO));
      ctx.drawImage(mark, width - mark.width - margin, height - mark.height - margin);
    } finally {
      URL.revokeObjectURL(markUrl);
    }

    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!out) throw new WatermarkError("Could not render the watermarked image");
    return out;
  } catch (err) {
    if (err instanceof WatermarkError) throw err;
    throw new WatermarkError("The watermark could not be applied to this image", { cause: err });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* -------------------------------------------------------------------------- */
/* The single entry point every download path must use                        */
/* -------------------------------------------------------------------------- */

/**
 * Watermark any media blob. Images go through canvas, everything else through
 * ffmpeg. Throws `WatermarkError` when the mark cannot be applied.
 */
export async function watermarkMediaBlob(
  blob: Blob,
  username: string | null | undefined,
  options: {
    filename?: string | undefined;
    onProgress?: ((progress: WatermarkProgress) => void) | undefined;
  } = {},
): Promise<Blob> {
  if (!blob || blob.size === 0) throw new WatermarkError("Nothing to watermark");
  if (isImageBlob(blob, options.filename)) {
    options.onProgress?.({ percent: 20, stage: "Watermarking" });
    const out = await watermarkImageBlob(blob, username);
    options.onProgress?.({ percent: 100, stage: "Done" });
    return out;
  }
  return watermarkVideoBlob(blob, username, options.onProgress);
}

/**
 * Output filename for a watermarked export. Video always lands as `.mp4`
 * (that is what ffmpeg produces); images land as `.png` (canvas output).
 */
export function watermarkedOutputName(filename: string, image: boolean): string {
  const base = filename.replace(/\.[^.]+$/, "");
  return `${base || "coolerup"}${image ? ".png" : ".mp4"}`;
}

/** Output MIME type for a watermarked export. */
export function watermarkedMimeType(image: boolean): string {
  return image ? "image/png" : "video/mp4";
}

/**
 * The one function every download / share-file path calls.
 *
 * Returns a `File` that is guaranteed to carry the watermark. There is no
 * parameter to skip it. If the mark fails, this rejects and the caller must
 * surface an error instead of handing the user the original bytes.
 */
export async function prepareWatermarkedFile(options: {
  blob: Blob;
  username: string | null | undefined;
  filename: string;
  onProgress?: (progress: WatermarkProgress) => void;
}): Promise<File> {
  const { blob, username, filename, onProgress } = options;
  const watermarked = await watermarkMediaBlob(blob, username, { filename, onProgress });

  const image = isImageBlob(blob, filename);
  return new File([watermarked as unknown as BlobPart], watermarkedOutputName(filename, image), {
    type: watermarkedMimeType(image),
    lastModified: Date.now(),
  });
}

/** Save a watermarked file to disk. */
export function saveFileToDisk(file: File): void {
  const href = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = href;
  a.download = file.name;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}

/** Default extension for a downloaded source URL. */
export function downloadExtension(url: string, blob: Blob): string {
  const match = (url || "").match(/\.([a-z0-9]{2,4})(?:[?#]|$)/i);
  if (match?.[1]) return match[1].toLowerCase();
  if (blob.type.includes("webm")) return "webm";
  if (blob.type.startsWith("image/")) return blob.type.split("/")[1] ?? "png";
  return "mp4";
}
