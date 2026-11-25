/**
 * On-device explicit-content detection.
 *
 * Text screening can never catch a silent naked video with a clean caption, so
 * uploads are also inspected visually: frames are pulled out of the file, drawn
 * to a canvas, and scored by an NSFW image classifier that ships inside the
 * `nsfwjs` package (MobileNetV2, ~3.5 MB, no API key, no network call, works
 * offline and inside the Capacitor Android shell).
 *
 * The classifier returns five labels: Drawing, Hentai, Neutral, Porn, Sexy.
 * Only Porn/Hentai are treated as a ban. "Sexy" is suggestive (swimwear,
 * lingerie, a shirtless gym clip) and is deliberately *not* enough to nuke an
 * account on its own — it only counts when there is also a real porn signal.
 *
 * Everything here fails open. If the model cannot load (old WebView, blocked
 * WASM, out of memory) the upload proceeds and the failure is logged, because a
 * broken classifier must not stop the whole app from accepting posts. The
 * database ladder is still there for text and for reports.
 */

export type NsfwLabel = "Drawing" | "Hentai" | "Neutral" | "Porn" | "Sexy";

export type NsfwVerdict = {
  /** True when the media should be treated as explicit sexual content. */
  explicit: boolean;
  /** Highest porn/hentai score seen across all sampled frames. */
  score: number;
  /** The label that produced the verdict, for the admin log. */
  label: NsfwLabel;
  /** How many frames were inspected. */
  frames: number;
};

/** A single frame has to clear this to count as porn. */
const PORN_THRESHOLD = 0.55;
/** Anime/drawn explicit content. */
const HENTAI_THRESHOLD = 0.55;
/** Suggestive alone is not a ban, but this much plus a porn signal is. */
const SEXY_THRESHOLD = 0.85;
const SEXY_PORN_SUPPORT = 0.2;

/** Frames sampled out of a video. More frames = slower but harder to dodge. */
const VIDEO_FRAMES = 6;
/** Hard cap on a single inspection. A slow phone must never hang an upload. */
const INSPECT_TIMEOUT_MS = 20_000;
/** Cold-start budget for TensorFlow + the model weights. */
const MODEL_LOAD_TIMEOUT_MS = 45_000;
/** Longest edge of the canvas handed to the model. */
const MAX_EDGE = 320;

export type Prediction = { className: NsfwLabel; probability: number };

type Classifier = {
  classify: (input: HTMLCanvasElement) => Promise<Prediction[]>;
};

let modelPromise: Promise<Classifier | null> | null = null;

/** Lazily pull in TensorFlow + the bundled model. Never runs during SSR. */
async function getClassifier(): Promise<Classifier | null> {
  if (typeof window === "undefined") return null;
  if (!modelPromise) {
    modelPromise = (async () => {
      try {
        const tf = await import("@tensorflow/tfjs");
        await tf.ready();
        // Import the core loader and *one* model definition rather than the
        // package index: the index statically pulls in all three bundled models
        // (~40 MB of weights). MobileNetV2 alone is ~3.5 MB.
        const { load } = await import("nsfwjs/core");
        const { MobileNetV2Model } = await import("nsfwjs/models/mobilenet_v2");
        const model = await load("MobileNetV2", { modelDefinitions: [MobileNetV2Model] });
        return model as unknown as Classifier;
      } catch (e) {
        console.error("[nsfw] classifier unavailable, skipping visual check", e);
        return null;
      }
    })();
  }
  return modelPromise;
}

function scoreOf(predictions: Prediction[], label: NsfwLabel): number {
  return predictions.find((p) => p.className === label)?.probability ?? 0;
}

export function judgePredictions(predictions: Prediction[], frames: number): NsfwVerdict {
  const porn = scoreOf(predictions, "Porn");
  const hentai = scoreOf(predictions, "Hentai");
  const sexy = scoreOf(predictions, "Sexy");

  const explicit =
    porn >= PORN_THRESHOLD ||
    hentai >= HENTAI_THRESHOLD ||
    (sexy >= SEXY_THRESHOLD && porn >= SEXY_PORN_SUPPORT);

  const label: NsfwLabel = porn >= hentai ? "Porn" : "Hentai";
  return { explicit, score: Math.max(porn, hentai), label: explicit ? label : "Neutral", frames };
}

function waitFor(target: EventTarget, event: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      cleanup();
      resolve();
    };
    const fail = () => {
      cleanup();
      reject(new Error(`timed out waiting for ${event}`));
    };
    const cleanup = () => {
      target.removeEventListener(event, done);
      target.removeEventListener("error", fail);
      clearTimeout(timer);
    };
    const timer = setTimeout(fail, timeoutMs);
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", fail, { once: true });
  });
}

function toCanvas(source: HTMLVideoElement | HTMLImageElement, w: number, h: number) {
  const scale = Math.min(1, MAX_EDGE / Math.max(w || MAX_EDGE, h || MAX_EDGE));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round((w || MAX_EDGE) * scale));
  canvas.height = Math.max(1, Math.round((h || MAX_EDGE) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** Evenly spaced seek points, skipping the first and last 3% (black frames). */
function sampleTimes(duration: number, count: number): number[] {
  const start = duration * 0.03;
  const end = duration * 0.97;
  if (!Number.isFinite(duration) || duration <= 0.2) return [0];
  const step = (end - start) / Math.max(1, count - 1);
  return Array.from({ length: count }, (_, i) => Math.min(end, start + step * i));
}

async function framesFromVideo(file: Blob): Promise<HTMLCanvasElement[]> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = "anonymous";
  video.src = url;

  const frames: HTMLCanvasElement[] = [];
  try {
    await waitFor(video, "loadeddata", 10_000);
    // MediaRecorder WebM often reports Infinity; fall back to the first frame.
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const times = sampleTimes(duration, VIDEO_FRAMES);
    for (const t of times) {
      if (duration > 0.2) {
        video.currentTime = Math.max(0, Math.min(t, duration - 0.05));
        try {
          await waitFor(video, "seeked", 4_000);
        } catch {
          // A stubborn seek should not lose the frames we already have.
          continue;
        }
      }
      const canvas = toCanvas(video, video.videoWidth, video.videoHeight);
      if (canvas) frames.push(canvas);
    }
  } catch (e) {
    console.error("[nsfw] could not read video frames", e);
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute("src");
    try {
      video.load();
    } catch {
      // ignore
    }
  }
  return frames;
}

async function frameFromImage(file: Blob): Promise<HTMLCanvasElement[]> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await waitFor(img, "load", 10_000);
    const canvas = toCanvas(img, img.naturalWidth, img.naturalHeight);
    return canvas ? [canvas] : [];
  } catch (e) {
    console.error("[nsfw] could not read image", e);
    return [];
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Can this environment decode media at all?
 *
 * This used to ask `video.canPlayType(type)`, which was a real hole: Chrome
 * returns "" for `video/quicktime`, so every iPhone `.mov` upload skipped the
 * check entirely. Instead probe for the APIs a real decoder exposes. jsdom has
 * neither, which is what keeps the unit tests from hanging on a 10s timeout.
 */
function hasVideoDecoder(): boolean {
  return typeof window !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;
}

function hasImageDecoder(): boolean {
  return typeof window !== "undefined" && typeof createImageBitmap === "function";
}

/**
 * Inspect an image or video file and decide whether it is explicit.
 *
 * Returns `null` when the check could not run at all (no model, unreadable
 * file) so callers can tell "clean" apart from "unknown".
 */
export async function inspectMedia(file: Blob): Promise<NsfwVerdict | null> {
  // Loading TensorFlow + 3.3 MB of weights is slow on a phone the first time,
  // and it used to share the 15s budget with the actual inspection. On a cold
  // start that meant the model finished loading *after* the race had already
  // resolved null, so the very first explicit upload sailed through. Give the
  // load its own generous budget and only timebox the frame work.
  const classifier = await withTimeout(getClassifier(), MODEL_LOAD_TIMEOUT_MS);
  if (!classifier) return null;
  return withTimeout(inspectFrames(file, classifier), INSPECT_TIMEOUT_MS);
}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

async function inspectFrames(file: Blob, classifier: Classifier): Promise<NsfwVerdict | null> {
  if (typeof window === "undefined") return null;
  if (!file || file.size === 0) return null;

  const isVideo = file.type.startsWith("video/");
  const isImage = file.type.startsWith("image/");
  if (!isVideo && !isImage) return null;
  // Probe for a real decoder rather than trusting the MIME type.
  if (isVideo && !hasVideoDecoder()) return null;
  if (isImage && !hasImageDecoder()) return null;

  const frames = isVideo ? await framesFromVideo(file) : await frameFromImage(file);
  if (frames.length === 0) return null;

  let worst: NsfwVerdict = { explicit: false, score: 0, label: "Neutral", frames: frames.length };
  for (const canvas of frames) {
    let predictions: Prediction[];
    try {
      predictions = await classifier.classify(canvas);
    } catch (e) {
      console.error("[nsfw] frame classification failed", e);
      continue;
    }
    const verdict = judgePredictions(predictions, frames.length);
    if (verdict.explicit) return verdict;
    if (verdict.score > worst.score) worst = verdict;
  }
  return worst;
}

/** Warm the model up in the background so the first upload is not slow. */
export function preloadNsfwModel(): void {
  if (typeof window === "undefined") return;
  void getClassifier();
}
