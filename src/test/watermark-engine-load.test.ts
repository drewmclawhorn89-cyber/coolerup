import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { watermarkCause, WatermarkError } from "@/lib/watermark";

/**
 * The ffmpeg core is a ~31 MB wasm download, so it is the fragile part of every
 * watermark. A single CDN having a bad day must not break downloads, and when
 * something does fail the console has to say what.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("ffmpeg core loading", () => {
  const source = read("src/lib/videoCompression.ts");

  it("tries more than one CDN mirror", () => {
    expect(source).toContain("CORE_BASES");
    expect(source).toMatch(/unpkg\.com\/@ffmpeg\/core/);
    expect(source).toMatch(/cdn\.jsdelivr\.net\/npm\/@ffmpeg\/core/);
    expect(source).toMatch(/cdnjs\.cloudflare\.com\/ajax\/libs\/ffmpeg-core/);
  });

  it("falls through to the next mirror when one fails", () => {
    expect(source).toContain("for (const base of CORE_BASES)");
    expect(source).toContain("lastError = err");
  });

  it("does not cache a failed load, so a retry actually retries", () => {
    expect(source).toContain("ffmpegPromise = null");
  });
});

describe("watermarkCause", () => {
  it("flattens the wrapped cause to its message", () => {
    const inner = new Error("Failed to fetch ffmpeg-core.wasm");
    const outer = new WatermarkError("The watermark could not be applied to this video", {
      cause: inner,
    });
    expect(watermarkCause(outer)).toBe("Failed to fetch ffmpeg-core.wasm");
  });

  it("accepts a plain error with no cause", () => {
    expect(watermarkCause(new Error("boom"))).toBe("boom");
  });

  it("accepts a string cause", () => {
    expect(watermarkCause({ cause: "network down" })).toBe("network down");
  });

  it("returns an empty string when there is nothing to say", () => {
    expect(watermarkCause(undefined)).toBe("");
    expect(watermarkCause({})).toBe("");
  });
});

describe("download failures are diagnosable", () => {
  for (const file of [
    "src/components/ShareMenu.tsx",
    "src/components/FullVideoShareMenu.tsx",
    "src/routes/offline.tsx",
  ]) {
    it(`${file} logs the underlying cause`, () => {
      const source = read(file);
      expect(source).toContain("watermarkCause");
      expect(source).toContain('console.error("Download failed:"');
    });
  }

  it("offline.tsx only relabels the two download handlers", () => {
    const source = read("src/routes/offline.tsx");
    // Seven catch blocks exist; exactly two are downloads.
    expect((source.match(/console\.error\(e\)/g) ?? []).length).toBe(5);
    expect((source.match(/Download failed:/g) ?? []).length).toBe(2);
  });
});
