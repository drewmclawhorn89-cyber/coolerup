/**
 * Smart watermarking for Coolerup exports.
 *
 * Videos with detected existing watermarks retain their original bytes.
 * Every other video or photo that leaves the app — a download, a share-sheet file, a
 * "save to camera roll" — is re-encoded here with the Coolerup logo and the
 * creator's `@username` burned in. On videos the mark moves clockwise every
 * 3 seconds (top-left → top-right → bottom-right → bottom-left → repeat) with a
 * smooth fade across each transition so it never pops or covers the middle.
 *
 * There is deliberately **no** flag, prop, setting or query parameter that can
 * turn this off. `prepareWatermarkedFile` is the only exported way to turn a
 * media blob into a downloadable file, and it checks video pixels first. If the mark
 * cannot be applied (no ffmpeg, out of memory, unsupported codec) it throws
 * `WatermarkError` and the caller must abort the download. Handing back an
 * unwatermarked clean file is never an option — a failed watermark is a failed
 * download, not a clean one.
 *
 * The watermark is drawn as a transparent PNG at export time (logo + handle)
 * and composited with ffmpeg's `overlay` filter (or canvas + `MediaRecorder`
 * fallback), so no font files or drawtext configuration are needed and the
 * result is identical on every platform.
 */

import { loadFfmpeg, type FfmpegLike } from "./videoCompression";
import { detectExistingVideoWatermark } from "./existingWatermark";

/** Opacity of the burned-in mark. Semi-transparent, but always legible. */
export const WATERMARK_ALPHA = 0.62;

/** Margin from the frame edges, as a fraction of the video's short side. */
export const WATERMARK_MARGIN_RATIO = 0.035;

/** Seconds the watermark stays in each corner before moving. */
export const WATERMARK_MOVE_INTERVAL_SECONDS = 3;

/** Duration (in seconds) of each fade-out / fade-in when moving corners. */
export const WATERMARK_FADE_SECONDS = 0.35;

/** Brief zero-opacity bridge around every 3s corner switch so frame boundaries never pop. */
export const WATERMARK_CORNER_HOLD_ZERO_SECONDS = 0.05;

/** Frame rate of the looped overlay stream used for smooth ffmpeg fade transitions. */
export const WATERMARK_FFMPEG_FPS = 15;

/** Exact corner rotation order: top-left → top-right → bottom-right → bottom-left → repeat. */
export type WatermarkCorner = "top-left" | "top-right" | "bottom-right" | "bottom-left";

export const WATERMARK_CORNER_SEQUENCE: readonly WatermarkCorner[] = [
  "top-left",
  "top-right",
  "bottom-right",
  "bottom-left",
];

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
/* Moving corner & fade schedule                                              */
/* -------------------------------------------------------------------------- */

/** Which corner the watermark occupies at `timeSeconds` (cycles every 3 s). */
export function watermarkCornerAtTime(timeSeconds: number): WatermarkCorner {
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const slot =
    Math.floor(safeTime / WATERMARK_MOVE_INTERVAL_SECONDS) % WATERMARK_CORNER_SEQUENCE.length;
  return WATERMARK_CORNER_SEQUENCE[slot] ?? "top-left";
}

/**
 * Relative opacity multiplier (`0..1`) at `timeSeconds`, multiplied on top of
 * `WATERMARK_ALPHA`. Starts fully visible at `t = 0`, then smoothly fades out
 * before every 3-second boundary and smoothly fades back in after switching corners.
 */
export function watermarkOpacityAtTime(timeSeconds: number): number {
  const safeTime = Number.isFinite(timeSeconds) && timeSeconds > 0 ? timeSeconds : 0;
  const interval = WATERMARK_MOVE_INTERVAL_SECONDS;
  const fade = WATERMARK_FADE_SECONDS;
  const holdZero = WATERMARK_CORNER_HOLD_ZERO_SECONDS;
  const fadeInEnd = holdZero + fade;
  const fadeOutStart = interval - holdZero - fade;
  const fadeOutEnd = interval - holdZero;

  if (safeTime < fadeInEnd) return 1;

  const slotTime = safeTime % interval;
  if (slotTime < holdZero) return 0;
  if (slotTime < fadeInEnd) return (slotTime - holdZero) / fade;
  if (slotTime < fadeOutStart) return 1;
  if (slotTime < fadeOutEnd) return (fadeOutEnd - slotTime) / fade;
  return 0;
}

export type WatermarkPlacement = {
  corner: WatermarkCorner;
  x: number;
  y: number;
  opacity: number;
};

/** Compute corner coordinates and fade opacity at `timeSeconds`, bounded safely inside the corners. */
export function watermarkPlacementAtTime(params: {
  timeSeconds: number;
  frameWidth: number;
  frameHeight: number;
  markWidth: number;
  markHeight: number;
  margin: number;
}): WatermarkPlacement {
  const { timeSeconds, frameWidth, frameHeight, markWidth, markHeight, margin } = params;
  const corner = watermarkCornerAtTime(timeSeconds);
  const opacity = watermarkOpacityAtTime(timeSeconds);

  const leftX = Math.max(0, Math.min(margin, frameWidth - markWidth));
  const rightX = Math.max(0, frameWidth - markWidth - margin);
  const topY = Math.max(0, Math.min(margin, frameHeight - markHeight));
  const bottomY = Math.max(0, frameHeight - markHeight - margin);

  switch (corner) {
    case "top-left":
      return { corner, x: leftX, y: topY, opacity };
    case "top-right":
      return { corner, x: rightX, y: topY, opacity };
    case "bottom-right":
      return { corner, x: rightX, y: bottomY, opacity };
    case "bottom-left":
      return { corner, x: leftX, y: bottomY, opacity };
  }
}

/** FFmpeg `-filter_complex` graph matching `watermarkPlacementAtTime` for video exports. */
export function buildMovingWatermarkFilterGraph(margin: number): string {
  const m = Math.max(0, Math.round(margin));
  const interval = WATERMARK_MOVE_INTERVAL_SECONDS;
  const fade = WATERMARK_FADE_SECONDS;
  const holdZero = WATERMARK_CORNER_HOLD_ZERO_SECONDS;
  const fadeInEnd = Number((holdZero + fade).toFixed(4));
  const fadeOutStart = Number((interval - holdZero - fade).toFixed(4));
  const fadeOutEnd = Number((interval - holdZero).toFixed(4));

  const alphaExpr = `alpha(X,Y)*(if(lt(T,${fadeInEnd}),1,if(lt(mod(T,${interval}),${holdZero}),0,if(lt(mod(T,${interval}),${fadeInEnd}),(mod(T,${interval})-${holdZero})/${fade},if(lt(mod(T,${interval}),${fadeOutStart}),1,if(lt(mod(T,${interval}),${fadeOutEnd}),(${fadeOutEnd}-mod(T,${interval}))/${fade},0))))))`;
  const xExpr = `if(eq(mod(floor(t/${interval}),4),0)+eq(mod(floor(t/${interval}),4),3),max(0,min(${m},main_w-overlay_w)),max(0,main_w-overlay_w-${m}))`;
  const yExpr = `if(lt(mod(floor(t/${interval}),4),2),max(0,min(${m},main_h-overlay_h)),max(0,main_h-overlay_h-${m}))`;

  return `[1:v]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='${alphaExpr}'[wm];[0:v][wm]overlay=x='${xExpr}':y='${yExpr}':format=auto:shortest=1[wmout]`;
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
  // clip get the same visual weight, while guaranteeing the mark stays small
  // inside a corner and never reaches the middle of the frame.
  const shortSide = Math.min(width, height);
  const margin = Math.max(6, Math.round(shortSide * WATERMARK_MARGIN_RATIO));
  const markSize = Math.max(14, Math.round(shortSide * 0.075));
  const gap = Math.max(3, Math.round(markSize * 0.22));
  let fontSize = Math.max(11, Math.round(markSize * 0.62));
  let handle = watermarkHandle(username);

  const fontFor = (size: number) =>
    `600 ${size}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

  // Measure on a scratch context first so the canvas is exactly as wide as the
  // mark needs to be — a full-frame PNG would bloat MEMFS for no reason.
  const scratch = document.createElement("canvas");
  const measureCtx = scratch.getContext("2d");
  if (!measureCtx) throw new WatermarkError("Canvas 2D is unavailable");

  const pad = Math.max(2, Math.round(markSize * 0.12));
  const maxArtWidth = Math.max(48, Math.floor(width * 0.44) - margin);

  measureCtx.font = fontFor(fontSize);
  let textWidth = Math.ceil(measureCtx.measureText(handle).width);

  const fixedWidth = pad * 2 + markSize + gap;
  if (fixedWidth + textWidth > maxArtWidth && textWidth > 0) {
    const availableText = Math.max(16, maxArtWidth - fixedWidth);
    fontSize = Math.max(9, Math.floor(fontSize * (availableText / textWidth)));
    measureCtx.font = fontFor(fontSize);
    textWidth = Math.ceil(measureCtx.measureText(handle).width);
    while (textWidth > availableText && handle.length > 2) {
      handle = `${handle.slice(0, -2)}…`;
      textWidth = Math.ceil(measureCtx.measureText(handle).width);
    }
  }

  const font = fontFor(fontSize);
  const artWidth = fixedWidth + textWidth;
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
 * ffmpeg path: highest quality, but needs a ~31 MB wasm engine and enough
 * memory to decode and re-encode the whole clip. This is the preferred path
 * and the one that runs on most desktop browsers.
 */
async function watermarkVideoWithFfmpeg(
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
      "-loop",
      "1",
      "-framerate",
      String(WATERMARK_FFMPEG_FPS),
      "-i",
      pngName,
      "-filter_complex",
      buildMovingWatermarkFilterGraph(margin),
      "-map",
      "[wmout]",
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
/* Fallback: canvas + MediaRecorder (no wasm, works on phones)                 */
/* -------------------------------------------------------------------------- */

/** Longest side of the recorded canvas. Keeps memory sane on phones. */
const RECORDER_MAX_SIDE = 1280;

/** Candidate container/codec strings, best first. */
const RECORDER_MIMES = [
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

/** First recording format this browser will actually produce. */
export function pickRecorderMime(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const mime of RECORDER_MIMES) {
    try {
      if (MediaRecorder.isTypeSupported(mime)) return mime;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

/**
 * Second path: play the video into a canvas with the watermark drawn on top and
 * record the result with `MediaRecorder`.
 *
 * This needs no wasm download and no full-file decode, so it works on phones
 * and low-memory machines where the ffmpeg path dies. It re-encodes in real
 * time, so a 30 s clip takes about 30 s.
 */
async function watermarkVideoWithRecorder(
  blob: Blob,
  username: string | null | undefined,
  onProgress?: (progress: WatermarkProgress) => void,
): Promise<Blob> {
  if (typeof document === "undefined" || typeof MediaRecorder === "undefined") {
    throw new WatermarkError("This browser cannot re-encode video");
  }
  const mime = pickRecorderMime();
  if (!mime) throw new WatermarkError("This browser cannot record video");

  const { width, height } = await probeVideo(blob);
  const scale = Math.min(1, RECORDER_MAX_SIDE / Math.max(width, height));
  const outWidth = Math.max(2, Math.round(width * scale));
  const outHeight = Math.max(2, Math.round(height * scale));

  onProgress?.({ percent: 5, stage: "Building watermark" });
  const png = await buildWatermarkPng(outWidth, outHeight, username);
  const markUrl = URL.createObjectURL(
    new Blob([png as unknown as BlobPart], { type: "image/png" }),
  );
  const srcUrl = URL.createObjectURL(blob);

  const canvas = document.createElement("canvas");
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    URL.revokeObjectURL(markUrl);
    URL.revokeObjectURL(srcUrl);
    throw new WatermarkError("Canvas 2D is unavailable");
  }

  const video = document.createElement("video");
  video.src = srcUrl;
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  let raf = 0;
  try {
    const mark = new Image();
    mark.src = markUrl;
    await mark.decode().catch(() => {
      throw new WatermarkError("Could not render the watermark");
    });

    await new Promise<void>((resolve, reject) => {
      video.addEventListener("loadeddata", () => resolve(), { once: true });
      video.addEventListener(
        "error",
        () => reject(new WatermarkError("Could not read this video")),
        { once: true },
      );
      setTimeout(() => reject(new WatermarkError("Could not read this video")), 20_000);
    });

    // Carry the original audio across when the browser exposes it.
    const stream = canvas.captureStream(30);
    const captured = (
      video as HTMLVideoElement & { captureStream?: () => MediaStream }
    ).captureStream?.();
    captured?.getAudioTracks().forEach((track) => stream.addTrack(track));

    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType: mime });
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    const finished = new Promise<void>((resolve, reject) => {
      recorder.onstop = () => resolve();
      recorder.onerror = () => reject(new WatermarkError("Recording the video failed"));
    });

    const margin = Math.max(6, Math.round(Math.min(outWidth, outHeight) * WATERMARK_MARGIN_RATIO));
    const draw = () => {
      if (video.ended || video.paused) return;
      ctx.drawImage(video, 0, 0, outWidth, outHeight);
      const { x, y, opacity } = watermarkPlacementAtTime({
        timeSeconds: video.currentTime,
        frameWidth: outWidth,
        frameHeight: outHeight,
        markWidth: mark.width,
        markHeight: mark.height,
        margin,
      });
      if (opacity > 0) {
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.drawImage(mark, x, y);
        ctx.restore();
      }
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (duration > 0) {
        onProgress?.({
          percent: Math.min(95, Math.max(10, Math.round((video.currentTime / duration) * 90))),
          stage: "Watermarking",
        });
      }
      raf = requestAnimationFrame(draw);
    };

    recorder.start(250);
    await video.play();
    draw();

    await new Promise<void>((resolve) => {
      video.addEventListener("ended", () => resolve(), { once: true });
      // A stalled or silent-ended element must not hang the download.
      const guard = setInterval(() => {
        if (video.ended) {
          clearInterval(guard);
          resolve();
        }
      }, 500);
      setTimeout(() => {
        clearInterval(guard);
        resolve();
      }, 15 * 60_000);
    });

    cancelAnimationFrame(raf);
    raf = 0;
    if (recorder.state !== "inactive") recorder.stop();
    await finished;

    if (chunks.length === 0) throw new WatermarkError("The watermarked video came back empty");
    onProgress?.({ percent: 100, stage: "Done" });
    const container = mime.split(";")[0] ?? "video/webm";
    return new Blob(chunks, { type: container });
  } finally {
    if (raf) cancelAnimationFrame(raf);
    try {
      video.pause();
    } catch {
      /* already stopped */
    }
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(srcUrl);
    URL.revokeObjectURL(markUrl);
  }
}

/**
 * Watermark a video, trying the high-quality ffmpeg path first and falling back
 * to the in-browser recorder when that engine cannot run.
 *
 * Both paths burn the same mark into the same corner. If both fail this throws
 * `WatermarkError` and the caller must abort the download — returning the
 * original bytes is never an option.
 */
export async function watermarkVideoBlob(
  blob: Blob,
  username: string | null | undefined,
  onProgress?: (progress: WatermarkProgress) => void,
): Promise<Blob> {
  let ffmpegError: unknown = null;
  try {
    return await watermarkVideoWithFfmpeg(blob, username, onProgress);
  } catch (err) {
    ffmpegError = err;
  }

  onProgress?.({ percent: 8, stage: "Trying a different encoder" });
  try {
    return await watermarkVideoWithRecorder(blob, username, onProgress);
  } catch (err) {
    const first = watermarkCause(ffmpegError);
    const second = watermarkCause(err);
    throw new WatermarkError(
      `The watermark could not be applied to this video${first || second ? ` (${[first, second].filter(Boolean).join("; ")})` : ""}`,
      { cause: err },
    );
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

/** Extension matching what the encoder actually produced. */
export function watermarkedExtension(blob: Blob, image: boolean): string {
  if (image) return "png";
  const type = (blob.type || "").toLowerCase();
  if (type.includes("webm")) return "webm";
  if (type.includes("quicktime")) return "mov";
  return "mp4";
}

/** Output MIME type for a watermarked export. */
export function watermarkedMimeType(image: boolean): string {
  return image ? "image/png" : "video/mp4";
}

/**
 * The one function every download / share-file path calls.
 *
 * Preserves detected existing video marks byte-for-byte; otherwise applies the
 * mandatory Coolerup mark. No caller-controlled bypass. Detection/encoding
 * failures reject instead of allowing an unchecked original download.
 */
export async function prepareWatermarkedFile(options: {
  blob: Blob;
  username: string | null | undefined;
  filename: string;
  onProgress?: (progress: WatermarkProgress) => void;
}): Promise<File> {
  const { blob, username, filename, onProgress } = options;
  if (!blob || blob.size === 0) throw new WatermarkError("Nothing to watermark");
  if (!isImageBlob(blob, filename)) {
    try {
      if (await detectExistingVideoWatermark(blob, onProgress)) {
        onProgress?.({ percent: 100, stage: "Done" });
        return new File([blob], filename, { type: blob.type, lastModified: Date.now() });
      }
    } catch (cause) {
      throw new WatermarkError("Could not check the video's existing watermark", { cause });
    }
  }
  const watermarked = await watermarkMediaBlob(blob, username, { filename, onProgress });

  const image = isImageBlob(blob, filename);
  const base = filename.replace(/\.[^.]+$/, "") || "coolerup";
  return new File(
    [watermarked as unknown as BlobPart],
    `${base}.${watermarkedExtension(watermarked, image)}`,
    {
      type: watermarked.type || watermarkedMimeType(image),
      lastModified: Date.now(),
    },
  );
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
