/**
 * Playback quality, TikTok-style.
 *
 * Every video row can carry four renditions (`video_1080_url` … `video_360_url`).
 * Until real transcoding is wired up, all four point at the same uploaded file,
 * so switching quality is instant and never breaks playback. The resolver below
 * always falls back to `video_url` when a rendition is missing, which is what
 * keeps older rows (uploaded before this feature) playing.
 *
 * Keep this module free of React so the upload path and tests can import it.
 */
import { useEffect, useState } from "react";
import type { EffectiveType } from "./network";

/** What the user picked. `data` is TikTok's "Data Saver". */
export type QualityId = "auto" | "1080p" | "720p" | "480p" | "360p" | "data";

/** A concrete rendition we can actually play. */
export type RenditionId = "1080p" | "720p" | "480p" | "360p";

export type QualityUrlKey =
  | "video_1080_url"
  | "video_720_url"
  | "video_480_url"
  | "video_360_url";

export type QualityOption = {
  id: QualityId;
  label: string;
  /** Shown under the label in the picker. */
  hint?: string;
};

export const QUALITY_OPTIONS: QualityOption[] = [
  { id: "auto", label: "Auto", hint: "Adjusts to your connection" },
  { id: "1080p", label: "1080p", hint: "Full HD" },
  { id: "720p", label: "720p", hint: "HD" },
  { id: "480p", label: "480p", hint: "Saves data" },
  { id: "360p", label: "360p", hint: "Lowest quality" },
  { id: "data", label: "Data Saver", hint: "Always stream the smallest file" },
];

/** The exact localStorage key the spec asks for (not namespaced). */
export const QUALITY_PREF_KEY = "video_quality";

const EVT = "video-quality-change";

const VALID: QualityId[] = ["auto", "1080p", "720p", "480p", "360p", "data"];

export function isQualityId(value: unknown): value is QualityId {
  return typeof value === "string" && (VALID as string[]).includes(value);
}

/** Read the saved preference. Anything unknown falls back to Auto. */
export function readQuality(): QualityId {
  if (typeof window === "undefined") return "auto";
  try {
    const raw = localStorage.getItem(QUALITY_PREF_KEY);
    return isQualityId(raw) ? raw : "auto";
  } catch {
    return "auto";
  }
}

export function writeQuality(quality: QualityId) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(QUALITY_PREF_KEY, quality);
  } catch {
    /* private mode / quota — the in-memory hook still updates */
  }
  window.dispatchEvent(new Event(EVT));
}

/** React hook: the shared preference, kept in sync across tabs and cards. */
export function useVideoQuality() {
  const [quality, setQuality] = useState<QualityId>("auto");
  useEffect(() => {
    const sync = () => setQuality(readQuality());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return {
    quality,
    setQuality: (next: QualityId) => writeQuality(next),
  };
}

/** Which column holds the rendition for a concrete quality. */
export function qualityUrlKey(quality: RenditionId): QualityUrlKey {
  // "1080p" -> video_1080_url (the column drops the "p").
  return `video_${quality.replace("p", "")}_url` as QualityUrlKey;
}

/** The subset of a video row this module needs. */
export type QualitySources = {
  video_url: string;
  video_1080_url?: string | null;
  video_720_url?: string | null;
  video_480_url?: string | null;
  video_360_url?: string | null;
};

/**
 * Auto picks a rendition from the connection:
 * 4g → 1080p, 3g → 720p, everything slower (or unknown) → 480p.
 */
export function autoRendition(effectiveType: EffectiveType = "unknown"): RenditionId {
  if (effectiveType === "4g") return "1080p";
  if (effectiveType === "3g") return "720p";
  return "480p";
}

/**
 * Which rendition a selection resolves to. `data` always means 360p; `auto`
 * asks the network. Returned separately so the UI can show what Auto chose.
 */
export function resolveRendition(
  quality: QualityId,
  effectiveType: EffectiveType = "unknown",
): RenditionId {
  if (quality === "auto") return autoRendition(effectiveType);
  if (quality === "data") return "360p";
  return quality;
}

export type ResolvedSource = {
  /** The URL to hand to the <video> element (still may be `storage:`). */
  url: string;
  /** Rendition that will play. */
  rendition: RenditionId;
  /** True when the row had no rendition for that quality and we fell back. */
  fallback: boolean;
  /** Badge text: only shown when the user picked a quality by hand. */
  badge: string | null;
};

/** Pick the URL for a quality, falling back to the original upload. */
export function resolveQualitySource(
  video: QualitySources,
  quality: QualityId,
  effectiveType: EffectiveType = "unknown",
): ResolvedSource {
  const rendition = resolveRendition(quality, effectiveType);
  const url = video[qualityUrlKey(rendition)];
  return {
    url: url || video.video_url,
    rendition,
    fallback: !url,
    // Auto hides the badge; Data Saver labels itself so the user knows why the
    // picture looks softer.
    badge: quality === "auto" ? null : quality === "data" ? "Data Saver" : rendition,
  };
}

/* -------------------------------------------------------------------------- */
/*  Upload helpers                                                            */
/* -------------------------------------------------------------------------- */

export type QualityUrls = Record<RenditionId, string>;

/**
 * Build the four rendition URLs for a freshly uploaded video.
 *
 * PHASE 1 (now): every quality points at the original file. That keeps uploads
 * instant and playback correct — the selector, badge and preference all work,
 * the bytes just aren't smaller yet.
 *
 * PHASE 2: replace the body with a call to the `transcode-video` Edge Function
 * (FFmpeg), e.g.
 *   ffmpeg -i input.mp4 -vf scale=-2:1080 -c:v libx264 -crf 23 1080.mp4
 *   ffmpeg -i input.mp4 -vf scale=-2:720  -c:v libx264 -crf 25 720.mp4
 *   ffmpeg -i input.mp4 -vf scale=-2:480  -c:v libx264 -crf 27 480.mp4
 *   ffmpeg -i input.mp4 -vf scale=-2:360  -c:v libx264 -crf 30 360.mp4
 * and return the uploaded URLs instead of the original.
 */
export async function createQualityVersions(original: File | string): Promise<QualityUrls> {
  const originalUrl = typeof original === "string" ? original : URL.createObjectURL(original);
  return {
    "1080p": originalUrl,
    "720p": originalUrl,
    "480p": originalUrl,
    "360p": originalUrl,
  };
}

/** Spread the rendition URLs into the shape the videos table expects. */
export function qualityColumns(urls: QualityUrls) {
  return {
    video_1080_url: urls["1080p"],
    video_720_url: urls["720p"],
    video_480_url: urls["480p"],
    video_360_url: urls["360p"],
  };
}
