/**
 * Smart Watermark detection for Coolerup downloads and uploads.
 *
 * Rule:
 * - If a video already carries a TikTok, Instagram, YouTube, or any other
 *   social media watermark from upload/import, download it exactly as it was
 *   uploaded (no Coolerup watermark added on top).
 * - If a video is an original Coolerup upload with no external watermark,
 *   always burn in Coolerup's moving watermark (logo + @username every 3s).
 */

export type SmartWatermarkPlatform =
  | "tiktok"
  | "instagram"
  | "youtube"
  | "facebook"
  | "snapchat"
  | "capcut"
  | "twitter"
  | "threads"
  | "likee"
  | "kwai"
  | "triller"
  | "external";

export type SmartWatermarkSource = {
  /** Stored flag detected when the video was originally uploaded/ingested. */
  hasExternalWatermark?: boolean | null | undefined;
  /** True for TikTok-synced rows. */
  isTikTok?: boolean | null | undefined;
  /** True for YouTube embeds/imports. */
  isYouTube?: boolean | null | undefined;
  /** External provider slug (e.g. "pexels", "tiktok", "instagram"). */
  sourceProvider?: string | null | undefined;
  /** Original source URL if imported from another platform. */
  sourceUrl?: string | null | undefined;
  /** Storage or remote video URL. */
  videoUrl?: string | null | undefined;
  /** Optional caption/title text (never trusted alone without platform hints). */
  filename?: string | null | undefined;
};

export type SmartWatermarkResult = {
  detected: boolean;
  platform: SmartWatermarkPlatform | null;
  reason: string | null;
};

export type FrameSample = {
  width: number;
  height: number;
  /** RGBA pixel buffer (`width * height * 4` bytes). */
  data: Uint8ClampedArray;
};

const CLEAN_PROVIDERS = new Set(["pexels", "coolerup", "internal", "local", "camera"]);

const PROVIDER_MAP: Array<[RegExp, SmartWatermarkPlatform]> = [
  [/\b(tiktok|douyin|musically)\b/i, "tiktok"],
  [/\b(instagram|reels|ig)\b/i, "instagram"],
  [/\b(youtube|ytshorts)\b/i, "youtube"],
  [/\b(facebook|fb)\b/i, "facebook"],
  [/\b(snapchat)\b/i, "snapchat"],
  [/\b(capcut)\b/i, "capcut"],
  [/\b(twitter|x\.com)\b/i, "twitter"],
  [/\b(threads)\b/i, "threads"],
  [/\b(likee)\b/i, "likee"],
  [/\b(kwai|kuaishou)\b/i, "kwai"],
  [/\b(triller)\b/i, "triller"],
];

const URL_OR_FILENAME_PATTERNS: Array<[RegExp, SmartWatermarkPlatform]> = [
  [
    /(?:tiktok\.com|tiktokcdn|snaptik|ssstik|tikmate|tikwm|savett|musically|musical\.ly|douyin|aweme|tiktok[-_])/i,
    "tiktok",
  ],
  [
    /(?:instagram\.com|cdninstagram|instagr\.am|saveinsta|instasave|snapinsta|ig[-_]?reels|igreels|fastdl)/i,
    "instagram",
  ],
  [
    /(?:youtube\.com|youtu\.be|googlevideo\.com|y2mate|yt5s|ssyoutube|ytshorts|yt[-_]?shorts)/i,
    "youtube",
  ],
  [/(?:facebook\.com|fb\.watch|fbcdn\.net|fdownloader|fbdown|getfvid|fb[-_]?reels)/i, "facebook"],
  [/(?:snapchat\.com|sc-cdn\.net|snapchat[-_])/i, "snapchat"],
  [/(?:capcut\.com|capcut[-_]|^lv_0_\d+)/i, "capcut"],
  [/(?:twitter\.com|twimg\.com|twdown|ssstwitter|x\.com\/)/i, "twitter"],
  [/(?:threads\.net|threads[-_])/i, "threads"],
  [/(?:likee\.video|likee[-_])/i, "likee"],
  [/(?:kwai\.com|kuaishou|kwai[-_])/i, "kwai"],
  [/(?:triller\.co|triller[-_])/i, "triller"],
];

const CONTAINER_SIGNATURES: Array<[RegExp, SmartWatermarkPlatform]> = [
  [
    /(?:bytedance|aigc_info|com\.zhiliaoapp\.musically|com\.ss\.android\.ugc\.trill|com\.ss\.android\.ugc\.aweme|tiktok|snaptik|ssstik|tikmate|tikwm|musical\.ly|douyin)/i,
    "tiktok",
  ],
  [/(?:com\.instagram|instagram\.com|instagr\.am|fbav|fb4a|fblite|cdninstagram)/i, "instagram"],
  [/(?:com\.google\.android\.youtube|youtube\.com|googlevideo|youtu\.be)/i, "youtube"],
  [/(?:facebook\.com|fbcdn\.net|com\.facebook)/i, "facebook"],
  [/(?:com\.snapchat|snapchat\.com)/i, "snapchat"],
  [/(?:com\.lemon\.lvoverseas|capcut)/i, "capcut"],
  [/(?:twitter\.com|com\.twitter\.android)/i, "twitter"],
  [/(?:threads\.net|com\.instagram\.barcelona)/i, "threads"],
  [/(?:likee\.video|sg\.bigo\.live)/i, "likee"],
  [/(?:com\.kwai|kuaishou)/i, "kwai"],
  [/(?:triller\.co|co\.triller)/i, "triller"],
];

/** Maximum bytes read from head and tail of a media blob when scanning container metadata. */
const HEADER_SCAN_BYTES = 256 * 1024;

function matchPattern(
  value: string | null | undefined,
  patterns: Array<[RegExp, SmartWatermarkPlatform]>,
): SmartWatermarkPlatform | null {
  const clean = (value ?? "").trim();
  if (!clean) return null;
  for (const [regex, platform] of patterns) {
    if (regex.test(clean)) return platform;
  }
  return null;
}

/**
 * Check structured database provenance, provider flags, URLs, and uploaded filename.
 */
export function detectExternalWatermarkFromSource(
  source?: SmartWatermarkSource | null,
  filename?: string | null,
): SmartWatermarkResult {
  if (source?.isTikTok) {
    return { detected: true, platform: "tiktok", reason: "is_tiktok" };
  }
  if (source?.isYouTube) {
    return { detected: true, platform: "youtube", reason: "is_youtube" };
  }
  if (source?.hasExternalWatermark) {
    return { detected: true, platform: "external", reason: "has_external_watermark" };
  }

  const provider = (source?.sourceProvider ?? "").trim().toLowerCase();
  if (provider && !CLEAN_PROVIDERS.has(provider)) {
    const matched = matchPattern(provider, PROVIDER_MAP) ?? "external";
    return { detected: true, platform: matched, reason: `source_provider:${provider}` };
  }

  for (const [label, value] of [
    ["source_url", source?.sourceUrl],
    ["video_url", source?.videoUrl],
    ["filename", source?.filename ?? filename],
  ] as const) {
    const hit = matchPattern(value, URL_OR_FILENAME_PATTERNS);
    if (hit) {
      return { detected: true, platform: hit, reason: `${label}:${hit}` };
    }
  }

  return { detected: false, platform: null, reason: null };
}

/**
 * Scan raw container bytes (MP4/MOV atoms, WebM tags, XMP comments) for social
 * media platform / downloader encoder strings.
 */
export function scanMediaHeaderSignatures(bytes: Uint8Array | ArrayBuffer): SmartWatermarkResult {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (view.length === 0) return { detected: false, platform: null, reason: null };

  // Keep printable ASCII characters so binary lengths/nulls between tag tokens
  // turn into spaces rather than breaking substring detection.
  let ascii = "";
  for (let i = 0; i < view.length; i += 1) {
    const code = view[i]!;
    ascii += code >= 0x20 && code <= 0x7e ? String.fromCharCode(code) : " ";
  }

  for (const [regex, platform] of CONTAINER_SIGNATURES) {
    if (regex.test(ascii)) {
      return { detected: true, platform, reason: `container_metadata:${platform}` };
    }
  }

  return { detected: false, platform: null, reason: null };
}

async function readBlobSliceBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") {
    return blob.arrayBuffer();
  }
  if (typeof FileReader !== "undefined") {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as ArrayBuffer) ?? new ArrayBuffer(0));
      reader.onerror = () => reject(reader.error ?? new Error("Could not read media bytes"));
      reader.readAsArrayBuffer(blob);
    });
  }
  if (typeof Response !== "undefined") {
    return new Response(blob).arrayBuffer();
  }
  return new ArrayBuffer(0);
}

async function readBlobHeaderAndTailBytes(blob: Blob): Promise<Uint8Array> {
  if (!blob || blob.size === 0) return new Uint8Array(0);
  if (blob.size <= HEADER_SCAN_BYTES * 2) {
    return new Uint8Array(await readBlobSliceBytes(blob));
  }
  const [headBuf, tailBuf] = await Promise.all([
    readBlobSliceBytes(blob.slice(0, HEADER_SCAN_BYTES)),
    readBlobSliceBytes(blob.slice(Math.max(0, blob.size - HEADER_SCAN_BYTES))),
  ]);
  const combined = new Uint8Array(headBuf.byteLength + tailBuf.byteLength);
  combined.set(new Uint8Array(headBuf), 0);
  combined.set(new Uint8Array(tailBuf), headBuf.byteLength);
  return combined;
}

type CornerZone = {
  name: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

function getCornerZones(width: number, height: number): CornerZone[] {
  const padX = Math.max(2, Math.round(width * 0.015));
  const padY = Math.max(2, Math.round(height * 0.015));
  const zoneW = Math.max(20, Math.round(width * 0.28));
  const zoneH = Math.max(16, Math.round(height * 0.22));
  return [
    {
      name: "top-left",
      x0: padX,
      y0: padY,
      x1: Math.min(width - 2, zoneW),
      y1: Math.min(height - 2, zoneH),
    },
    {
      name: "top-right",
      x0: Math.max(2, width - zoneW),
      y0: padY,
      x1: width - padX,
      y1: Math.min(height - 2, zoneH),
    },
    {
      name: "bottom-right",
      x0: Math.max(2, width - zoneW),
      y0: Math.max(2, height - zoneH),
      x1: width - padX,
      y1: height - padY,
    },
    {
      name: "bottom-left",
      x0: padX,
      y0: Math.max(2, height - zoneH),
      x1: Math.min(width - 2, zoneW),
      y1: height - padY,
    },
  ];
}

function lumaAt(data: Uint8ClampedArray, idx: number): number {
  return data[idx]! * 0.299 + data[idx + 1]! * 0.587 + data[idx + 2]! * 0.114;
}

function analyzeFrameCornerColors(frame: FrameSample): {
  tiktok: boolean;
  youtube: boolean;
} {
  const { width, height, data } = frame;
  if (width < 40 || height < 40 || data.length < width * height * 4) {
    return { tiktok: false, youtube: false };
  }

  const zones = getCornerZones(width, height);
  let tiktok = false;
  let youtube = false;

  for (const zone of zones) {
    const area = Math.max(1, (zone.x1 - zone.x0) * (zone.y1 - zone.y0));
    let cyanCount = 0;
    let magentaCount = 0;
    let whiteStrokeCount = 0;
    let ytRedCount = 0;

    for (let y = zone.y0; y < zone.y1; y += 1) {
      for (let x = zone.x0; x < zone.x1; x += 1) {
        const i = (y * width + x) * 4;
        const r = data[i]!;
        const g = data[i + 1]!;
        const b = data[i + 2]!;

        // TikTok iconic cyan (#25F4EE) and pink/magenta (#FE2C55) chromatic fringe
        if (b > 135 && g > 135 && b - r > 55 && g - r > 45) {
          cyanCount += 1;
        }
        if (r > 140 && b > 55 && r - g > 65 && b < r) {
          magentaCount += 1;
        }
        // YouTube iconic red badge (#FF0000 / #E62117)
        if (r > 175 && g < 65 && b < 65 && r - g > 125) {
          ytRedCount += 1;
        }

        // High-contrast bright logo/text stroke against neighbor pixels
        const lum = r * 0.299 + g * 0.587 + b * 0.114;
        if (lum > 175 && Math.abs(r - g) < 40 && Math.abs(g - b) < 40) {
          const rightLum = lumaAt(data, i + 4);
          const downLum = lumaAt(data, i + width * 4);
          if (Math.abs(lum - rightLum) > 28 || Math.abs(lum - downLum) > 28) {
            whiteStrokeCount += 1;
          }
        }
      }
    }

    // Small, concentrated badge — exclude full-zone neon flood lighting
    if (
      cyanCount >= 5 &&
      magentaCount >= 5 &&
      whiteStrokeCount >= 6 &&
      cyanCount / area < 0.25 &&
      magentaCount / area < 0.25
    ) {
      tiktok = true;
    }

    if (ytRedCount >= 8 && whiteStrokeCount >= 6 && ytRedCount / area < 0.22) {
      youtube = true;
    }
  }

  return { tiktok, youtube };
}

/**
 * Detect a crisp, spatially-locked bright corner overlay (Instagram Reels,
 * Snapchat, CapCut, Facebook Reels, Likee, etc.) while the center scene moves.
 */
function hasStaticCornerOverlayPair(a: FrameSample, b: FrameSample): boolean {
  if (a.width !== b.width || a.height !== b.height) return false;
  const { width, height } = a;
  if (width < 48 || height < 48) return false;

  // Measure center motion so still photos / tripod frames don't trigger false positives.
  const cx0 = Math.floor(width * 0.3);
  const cx1 = Math.floor(width * 0.7);
  const cy0 = Math.floor(height * 0.3);
  const cy1 = Math.floor(height * 0.7);
  let centerDiffSum = 0;
  let centerPixels = 0;
  for (let y = cy0; y < cy1; y += 2) {
    for (let x = cx0; x < cx1; x += 2) {
      const i = (y * width + x) * 4;
      centerDiffSum += Math.abs(lumaAt(a.data, i) - lumaAt(b.data, i));
      centerPixels += 1;
    }
  }
  const centerMotion = centerPixels > 0 ? centerDiffSum / centerPixels : 0;
  if (centerMotion < 7) return false;

  const zones = getCornerZones(width, height);
  for (const zone of zones) {
    const area = Math.max(1, (zone.x1 - zone.x0) * (zone.y1 - zone.y0));
    let strokeA = 0;
    let strokeStable = 0;
    let nonStrokeDiffSum = 0;
    let nonStrokeCount = 0;

    for (let y = zone.y0; y < zone.y1; y += 1) {
      for (let x = zone.x0; x < zone.x1; x += 1) {
        const i = (y * width + x) * 4;
        const lumA = lumaAt(a.data, i);
        const lumB = lumaAt(b.data, i);

        // Edge / stroke check in frame A
        const gradA = Math.max(
          Math.abs(lumA - lumaAt(a.data, i + 4)),
          Math.abs(lumA - lumaAt(a.data, i + width * 4)),
        );
        const isBrightStrokeA = lumA > 155 && gradA > 26;

        if (isBrightStrokeA) {
          strokeA += 1;
          const gradB = Math.max(
            Math.abs(lumB - lumaAt(b.data, i + 4)),
            Math.abs(lumB - lumaAt(b.data, i + width * 4)),
          );
          if (lumB > 145 && gradB > 20 && Math.abs(lumA - lumB) < 28) {
            strokeStable += 1;
          }
        } else {
          nonStrokeDiffSum += Math.abs(lumA - lumB);
          nonStrokeCount += 1;
        }
      }
    }

    const stabilityRatio = strokeA > 0 ? strokeStable / strokeA : 0;
    const bgMotion = nonStrokeCount > 0 ? nonStrokeDiffSum / nonStrokeCount : 0;

    // A watermark creates dense, locked bright strokes (`>= 18` edge pixels)
    // occupying a small badge footprint (`<= 28%` of corner) that stay still
    // even as either the corner background or main scene moves.
    if (
      strokeA >= 18 &&
      strokeA / area <= 0.28 &&
      stabilityRatio >= 0.78 &&
      (bgMotion >= 2.5 || centerMotion >= 12)
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Pure pixel analyzer over sampled video frames. Works in both browser `<canvas>`
 * inspection and deterministic Node/Vitest unit tests.
 */
export function analyzeCornerWatermarkFrames(frames: readonly FrameSample[]): SmartWatermarkResult {
  if (!frames || frames.length === 0) {
    return { detected: false, platform: null, reason: null };
  }

  let tiktokHits = 0;
  let youtubeHits = 0;
  for (const frame of frames) {
    const color = analyzeFrameCornerColors(frame);
    if (color.tiktok) tiktokHits += 1;
    if (color.youtube) youtubeHits += 1;
  }

  const requiredColorHits = frames.length >= 2 ? 2 : 1;
  if (tiktokHits >= requiredColorHits) {
    return { detected: true, platform: "tiktok", reason: "visual_tiktok_chroma" };
  }
  if (youtubeHits >= requiredColorHits) {
    return { detected: true, platform: "youtube", reason: "visual_youtube_badge" };
  }

  if (frames.length >= 2) {
    let staticPairHits = 0;
    for (let i = 0; i < frames.length - 1; i += 1) {
      if (hasStaticCornerOverlayPair(frames[i]!, frames[i + 1]!)) {
        staticPairHits += 1;
      }
    }
    if (staticPairHits >= 1) {
      return { detected: true, platform: "external", reason: "visual_static_corner_overlay" };
    }
  }

  return { detected: false, platform: null, reason: null };
}

/**
 * Sample a few frames from a browser-playable video blob and inspect the 4
 * outer corners for burned-in social media watermarks. Never throws.
 */
export async function inspectVideoFramesForWatermark(blob: Blob): Promise<SmartWatermarkResult> {
  if (
    typeof document === "undefined" ||
    typeof URL === "undefined" ||
    typeof URL.createObjectURL !== "function" ||
    !blob ||
    blob.size === 0 ||
    blob.type.startsWith("image/")
  ) {
    return { detected: false, platform: null, reason: null };
  }

  if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) {
    return { detected: false, platform: null, reason: null };
  }

  const probeCanvas = document.createElement("canvas");
  if (!probeCanvas.getContext("2d", { willReadFrequently: true })) {
    return { detected: false, platform: null, reason: null };
  }

  const url = URL.createObjectURL(blob);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;

  try {
    const loaded = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 3500);
      const done = (ok: boolean) => {
        clearTimeout(timer);
        resolve(ok);
      };
      video.addEventListener("loadeddata", () => done(true), { once: true });
      video.addEventListener("error", () => done(false), { once: true });
    });

    if (!loaded || !video.videoWidth || !video.videoHeight) {
      return { detected: false, platform: null, reason: null };
    }

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 1;
    const scale = Math.min(1, 240 / Math.max(video.videoWidth, video.videoHeight));
    const width = Math.max(48, Math.round(video.videoWidth * scale));
    const height = Math.max(48, Math.round(video.videoHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { detected: false, platform: null, reason: null };

    const rawPoints = [0.2, 0.9, 1.8, 3.25];
    const times = Array.from(
      new Set(
        rawPoints.map((t) => {
          const clamped = Math.min(Math.max(0.05, t), Math.max(0.1, duration - 0.1));
          return Number(clamped.toFixed(2));
        }),
      ),
    );

    const frames: FrameSample[] = [];
    for (const targetTime of times) {
      const seekOk = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), 1200);
        const finish = (ok: boolean) => {
          clearTimeout(timer);
          resolve(ok);
        };
        if (Math.abs(video.currentTime - targetTime) < 0.04 && video.readyState >= 2) {
          finish(true);
          return;
        }
        video.addEventListener("seeked", () => finish(true), { once: true });
        video.addEventListener("error", () => finish(false), { once: true });
        try {
          video.currentTime = targetTime;
        } catch {
          finish(false);
        }
      });

      if (!seekOk) continue;
      try {
        ctx.drawImage(video, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        frames.push({ width, height, data: imageData.data });
      } catch {
        /* ignore single-frame read issues */
      }
    }

    return analyzeCornerWatermarkFrames(frames);
  } catch {
    return { detected: false, platform: null, reason: null };
  } finally {
    try {
      video.removeAttribute("src");
      video.load();
    } catch {
      /* ignore cleanup error */
    }
    URL.revokeObjectURL(url);
  }
}

/**
 * Full Smart Watermark check combining:
 * 1. Stored upload/sync provenance (`hasExternalWatermark`, `isTikTok`, `isYouTube`, URL, filename)
 * 2. MP4 / MOV / WebM container metadata scan
 * 3. Visual frame corner & platform chromatic signature scan
 */
export async function detectExternalWatermark(params: {
  blob: Blob;
  filename?: string | null | undefined;
  source?: SmartWatermarkSource | null | undefined;
}): Promise<SmartWatermarkResult> {
  const fromSource = detectExternalWatermarkFromSource(params.source, params.filename);
  if (fromSource.detected) return fromSource;

  if (!params.blob || params.blob.size === 0) {
    return { detected: false, platform: null, reason: null };
  }

  try {
    const headerBytes = await readBlobHeaderAndTailBytes(params.blob);
    const fromHeader = scanMediaHeaderSignatures(headerBytes);
    if (fromHeader.detected) return fromHeader;
  } catch {
    /* ignore binary read failure */
  }

  return inspectVideoFramesForWatermark(params.blob);
}

/**
 * Return the uploaded media bytes untouched in a `File`, preserving extension
 * and MIME type when downloading a video that already carries a social watermark.
 */
export function wrapOriginalUploadedFile(blob: Blob, filename: string): File {
  const safeName = (filename || "").trim() || "coolerup.mp4";
  const fallbackMime = /\.(png|jpe?g|webp|gif|avif|heic)$/i.test(safeName)
    ? "image/png"
    : safeName.toLowerCase().endsWith(".webm")
      ? "video/webm"
      : "video/mp4";
  return new File([blob as unknown as BlobPart], safeName, {
    type: blob.type || fallbackMime,
    lastModified: Date.now(),
  });
}
