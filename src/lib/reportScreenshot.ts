/**
 * Captures a lightweight JPEG frame from an HTMLVideoElement when reporting a video,
 * and safely validates HTTP(S) thumbnail URLs for email delivery.
 */

const MAX_CAPTURE_WIDTH = 480;

export function captureVideoScreenshot(
  videoEl: HTMLVideoElement | null | undefined,
): string | null {
  if (!videoEl || typeof document === "undefined") return null;
  const vw = videoEl.videoWidth;
  const vh = videoEl.videoHeight;
  if (!vw || !vh) return null;

  try {
    const scale = vw > MAX_CAPTURE_WIDTH ? MAX_CAPTURE_WIDTH / vw : 1;
    const width = Math.max(1, Math.round(vw * scale));
    const height = Math.max(1, Math.round(vh * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(videoEl, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.72);
    if (!dataUrl.startsWith("data:image/")) return null;
    // Keep inline screenshot comfortably under serverless payload limits (~250KB).
    return dataUrl.length <= 320_000 ? dataUrl : null;
  } catch {
    // Tainted cross-origin video canvas: fall back to stored thumbnail_url on the server.
    return null;
  }
}

export function resolveSafeHttpUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("https://") || trimmed.startsWith("http://")) {
    return trimmed;
  }
  return null;
}
