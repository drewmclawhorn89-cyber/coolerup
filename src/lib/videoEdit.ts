/**
 * Client-side trimming for Shorts.
 *
 * The editor lets a creator cut the head/tail off a clip they already posted.
 * We re-encode with ffmpeg.wasm (already used for long-upload compression) and
 * hand the resulting MP4 back to the caller, which uploads it and repoints the
 * `videos` row. Re-encoding rather than stream-copying keeps the cut frame
 * accurate on every device — a `-c copy` cut snaps to the nearest keyframe,
 * which on a phone clip can be several seconds off.
 *
 * Like `videoCompression.ts`, this module loads ffmpeg lazily so the main
 * bundle stays small and only people who actually trim pay for the wasm.
 */

import { loadFfmpeg, type FfmpegLike } from "./videoCompression";

export type TrimProgress = {
  /** 0–100. */
  percent: number;
  /** Human-readable phase, e.g. "Trimming". */
  stage: string;
};

/** Shortest clip the editor will produce. */
export const MIN_TRIM_SECONDS = 1;

function extensionOf(name: string): string {
  const match = /\.[a-z0-9]+$/i.exec(name);
  return match ? match[0].toLowerCase() : ".mp4";
}

/**
 * Cut `file` down to `[startSeconds, endSeconds]`.
 *
 * Returns a new MP4 `File`. Throws when ffmpeg can't load or the encode fails —
 * the caller surfaces that as a toast and leaves the original video alone.
 */
export async function trimVideoFile(
  file: File,
  startSeconds: number,
  endSeconds: number,
  onProgress: (progress: TrimProgress) => void,
): Promise<File> {
  const start = Math.max(0, startSeconds);
  const duration = Math.max(MIN_TRIM_SECONDS, endSeconds - start);

  let ffmpeg: FfmpegLike | null = null;
  let handler: ((e: { progress: number; time: number }) => void) | null = null;

  const inName = `edit_in_${Date.now()}${extensionOf(file.name)}`;
  const outName = `edit_out_${Date.now()}.mp4`;

  try {
    onProgress({ percent: 0, stage: "Loading editor" });
    ffmpeg = await loadFfmpeg();

    onProgress({ percent: 3, stage: "Reading video" });
    const bytes = new Uint8Array(await file.arrayBuffer());
    await ffmpeg.writeFile(inName, bytes);

    handler = ({ progress }) => {
      const ratio = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 0;
      onProgress({ percent: 5 + Math.round(ratio * 90), stage: "Trimming" });
    };
    ffmpeg.on("progress", handler);

    const code = await ffmpeg.exec([
      "-ss",
      start.toFixed(3),
      "-i",
      inName,
      "-t",
      duration.toFixed(3),
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

    if (code !== 0) throw new Error(`ffmpeg exited with ${code}`);

    onProgress({ percent: 97, stage: "Finishing" });
    const data = await ffmpeg.readFile(outName);
    if (typeof data === "string") throw new Error("ffmpeg returned no video data");

    // `readFile` hands back a view into the wasm heap — copy before ffmpeg is
    // reused or the bytes can be overwritten underneath us.
    const copy = new Uint8Array(data.length);
    copy.set(data);

    const base = file.name.replace(/\.[^.]+$/, "") || "clip";
    const out = new File([copy], `${base}-edited.mp4`, { type: "video/mp4" });
    onProgress({ percent: 100, stage: "Done" });
    return out;
  } finally {
    if (ffmpeg) {
      if (handler) {
        try {
          ffmpeg.off("progress", handler);
        } catch {
          /* instance already gone */
        }
      }
      await ffmpeg.deleteFile(inName).catch(() => {});
      await ffmpeg.deleteFile(outName).catch(() => {});
    }
  }
}
