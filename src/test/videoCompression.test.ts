import { describe, expect, it } from "vitest";
import {
  COMPRESS_MAX_BYTES,
  COMPRESS_MIN_BYTES,
  COMPRESS_MIN_DURATION_SECONDS,
  shouldCompress,
} from "@/lib/videoCompression";

/** Build a File of a given size without allocating the bytes. */
function fileOfSize(bytes: number): File {
  const file = new File([""], "clip.mp4", { type: "video/mp4" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
}

const MB = 1024 * 1024;

describe("shouldCompress", () => {
  it("leaves short clips alone even when they are large", () => {
    expect(shouldCompress(fileOfSize(200 * MB), COMPRESS_MIN_DURATION_SECONDS)).toBe(false);
  });

  it("leaves long but small videos alone", () => {
    expect(shouldCompress(fileOfSize(20 * MB), 10 * 60)).toBe(false);
  });

  it("compresses a long, heavy video", () => {
    // 10 minutes, 500 MB — the exact case from the bug report.
    expect(shouldCompress(fileOfSize(500 * MB), 600)).toBe(true);
  });

  it("does not try to re-encode files too big for the wasm heap", () => {
    expect(shouldCompress(fileOfSize(COMPRESS_MAX_BYTES + 1), 600)).toBe(false);
  });

  it("uses the documented thresholds", () => {
    expect(shouldCompress(fileOfSize(COMPRESS_MIN_BYTES + 1), COMPRESS_MIN_DURATION_SECONDS + 1)).toBe(
      true,
    );
  });
});
