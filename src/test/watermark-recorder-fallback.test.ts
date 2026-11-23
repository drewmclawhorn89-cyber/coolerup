import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { pickRecorderMime, watermarkedExtension, WatermarkError } from "@/lib/watermark";

/**
 * The ffmpeg path needs a ~31 MB wasm download plus enough memory to decode and
 * re-encode the whole clip. That dies on plenty of phones, which is why the
 * download button used to answer "Couldn't watermark this video". The recorder
 * path is the second chance: canvas + MediaRecorder, no wasm.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const source = read("src/lib/watermark.ts");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickRecorderMime", () => {
  it("returns null when the browser has no MediaRecorder", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(pickRecorderMime()).toBeNull();
  });

  it("prefers MP4 with H.264 when the browser supports it", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (mime: string) => mime.startsWith("video/mp4"),
    });
    expect(pickRecorderMime()).toBe("video/mp4;codecs=avc1.42E01E");
  });

  it("falls back to WebM when MP4 recording is unsupported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: (mime: string) => mime.startsWith("video/webm"),
    });
    expect(pickRecorderMime()).toBe("video/webm;codecs=vp9");
  });

  it("returns null when nothing at all is supported", () => {
    vi.stubGlobal("MediaRecorder", { isTypeSupported: () => false });
    expect(pickRecorderMime()).toBeNull();
  });

  it("survives a browser that throws from isTypeSupported", () => {
    vi.stubGlobal("MediaRecorder", {
      isTypeSupported: () => {
        throw new Error("nope");
      },
    });
    expect(pickRecorderMime()).toBeNull();
  });
});

describe("watermarkedExtension", () => {
  it("names photos .png", () => {
    expect(watermarkedExtension(new Blob([], { type: "image/jpeg" }), true)).toBe("png");
  });

  it("names a recorder WebM output .webm, not .mp4", () => {
    expect(watermarkedExtension(new Blob([], { type: "video/webm" }), false)).toBe("webm");
  });

  it("names a QuickTime output .mov", () => {
    expect(watermarkedExtension(new Blob([], { type: "video/quicktime" }), false)).toBe("mov");
  });

  it("defaults to .mp4 for MP4 and unknown types", () => {
    expect(watermarkedExtension(new Blob([], { type: "video/mp4" }), false)).toBe("mp4");
    expect(watermarkedExtension(new Blob([]), false)).toBe("mp4");
  });
});

describe("watermarkVideoBlob fall-through", () => {
  it("tries ffmpeg first", () => {
    expect(source).toMatch(
      /export async function watermarkVideoBlob[\s\S]{0,400}watermarkVideoWithFfmpeg\(/,
    );
  });

  it("falls back to the recorder when ffmpeg fails", () => {
    expect(source).toMatch(/ffmpegError = err;[\s\S]{0,600}watermarkVideoWithRecorder\(/);
  });

  it("tells the user it is switching encoders", () => {
    expect(source).toContain('stage: "Trying a different encoder"');
  });

  it("fails closed with both causes when neither encoder works", () => {
    expect(source).toMatch(/const first = watermarkCause\(ffmpegError\)/);
    expect(source).toMatch(/const second = watermarkCause\(err\)/);
    expect(source).toMatch(/throw new WatermarkError\(/);
  });

  it("never returns the original bytes as a success", () => {
    expect(source).not.toMatch(/return blob;[\s\S]{0,80}watermark/);
  });
});

describe("recorder encoder", () => {
  it("caps the canvas so phones do not run out of memory", () => {
    expect(source).toContain("RECORDER_MAX_SIDE = 1280");
    expect(source).toMatch(/Math\.min\(1, RECORDER_MAX_SIDE \/ Math\.max\(width, height\)\)/);
  });

  it("records from a canvas stream and keeps the audio track", () => {
    expect(source).toContain("captureStream");
    expect(source).toContain("new MediaRecorder(stream");
  });

  it("gives up on a stuck video instead of hanging forever", () => {
    expect(source).toContain("15 * 60_000");
  });

  it("rejects an empty recording rather than handing back nothing", () => {
    expect(source).toContain('throw new WatermarkError("The watermarked video came back empty")');
  });
});

describe("WatermarkError", () => {
  it("is the error type the download buttons check for", () => {
    const err = new WatermarkError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WatermarkError");
  });
});
