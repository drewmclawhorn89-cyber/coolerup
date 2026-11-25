import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  WATERMARK_ALPHA,
  WATERMARK_LOGO_SRC,
  WatermarkError,
  downloadExtension,
  isImageBlob,
  prepareWatermarkedFile,
  watermarkHandle,
  watermarkMediaBlob,
  watermarkedMimeType,
  watermarkedOutputName,
} from "@/lib/watermark";

/**
 * The watermark is a hard product rule: every file that leaves Coolerup carries
 * the logo + @handle, and there is no toggle anywhere that can turn it off.
 *
 * These tests pin two things — the helper's own behaviour, and the fact that
 * every download / share-file call site actually routes through it. A future
 * refactor that re-introduces a raw `URL.createObjectURL(blob)` download will
 * fail here.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("watermark handle", () => {
  it("adds a single leading @", () => {
    expect(watermarkHandle("drew")).toBe("@drew");
  });

  it("collapses duplicated @ signs", () => {
    expect(watermarkHandle("@@drew")).toBe("@drew");
    expect(watermarkHandle("  @drew  ")).toBe("@drew");
  });

  it("falls back to the brand handle when the creator is unknown", () => {
    expect(watermarkHandle(null)).toBe("@coolerup");
    expect(watermarkHandle(undefined)).toBe("@coolerup");
    expect(watermarkHandle("   ")).toBe("@coolerup");
    expect(watermarkHandle("@")).toBe("@coolerup");
  });
});

describe("media type detection", () => {
  it("treats image mime types as images", () => {
    expect(isImageBlob(new Blob([], { type: "image/png" }))).toBe(true);
    expect(isImageBlob(new Blob([], { type: "image/jpeg" }))).toBe(true);
  });

  it("treats video mime types as video", () => {
    expect(isImageBlob(new Blob([], { type: "video/mp4" }))).toBe(false);
    expect(isImageBlob(new Blob([], { type: "video/webm" }))).toBe(false);
  });

  it("falls back to the filename when the mime type is generic", () => {
    expect(isImageBlob(new Blob([]), "photo.JPG")).toBe(true);
    expect(isImageBlob(new Blob([]), "clip.mp4")).toBe(false);
  });
});

describe("download extension", () => {
  it("prefers the URL extension", () => {
    expect(downloadExtension("https://x.test/a/b.webm?token=1", new Blob([]))).toBe("webm");
  });

  it("falls back to the blob mime type", () => {
    expect(downloadExtension("https://x.test/stream", new Blob([], { type: "video/webm" }))).toBe(
      "webm",
    );
    expect(downloadExtension("https://x.test/stream", new Blob([], { type: "image/png" }))).toBe(
      "png",
    );
  });

  it("defaults to mp4", () => {
    expect(downloadExtension("https://x.test/stream", new Blob([]))).toBe("mp4");
  });
});

describe("watermark is always on", () => {
  it("uses a semi-transparent mark", () => {
    expect(WATERMARK_ALPHA).toBeGreaterThan(0);
    expect(WATERMARK_ALPHA).toBeLessThan(1);
  });

  it("draws the Coolerup logo", () => {
    expect(WATERMARK_LOGO_SRC).toBe("/icon-192-coolerup.png");
  });

  it("exposes no way to disable the watermark", () => {
    const src = read("src/lib/watermark.ts");
    // No boolean escape hatch anywhere in the module's public surface.
    expect(src).not.toMatch(/watermark\s*[:=]\s*(false|true)/i);
    expect(src).not.toMatch(/disableWatermark|skipWatermark|withoutWatermark|noWatermark/i);
    expect(src).not.toMatch(/enabled\?\s*:/);
    expect(src).not.toMatch(/if\s*\(\s*!?\s*options\.(enabled|watermark|skip)\b/);
  });

  it("refuses an empty blob instead of returning it untouched", async () => {
    await expect(watermarkMediaBlob(new Blob([]), "drew")).rejects.toBeInstanceOf(WatermarkError);
  });

  it("surfaces failures as WatermarkError so callers can abort", () => {
    const src = read("src/lib/watermark.ts");
    expect(src).toMatch(/class WatermarkError extends Error/);
    expect(src).toMatch(/throw new WatermarkError/);
    // The failure path must never `return blob`.
    expect(src).not.toMatch(/catch[\s\S]{0,200}return blob;/);
  });

  it("prepareWatermarkedFile rejects rather than returning the original bytes", async () => {
    // jsdom has no canvas/image pipeline, so this exercises the real failure
    // path: the export must abort, never fall back to the clean blob.
    await expect(
      prepareWatermarkedFile({
        blob: new Blob([new Uint8Array([9])], { type: "image/png" }),
        username: "drew",
        filename: "abc.png",
      }),
    ).rejects.toBeInstanceOf(WatermarkError);
  });

  it("names video exports .mp4 and image exports .png", () => {
    expect(watermarkedOutputName("abc.webm", false)).toBe("abc.mp4");
    expect(watermarkedOutputName("abc", false)).toBe("abc.mp4");
    expect(watermarkedOutputName("photo.jpg", true)).toBe("photo.png");
    expect(watermarkedOutputName("", true)).toBe("coolerup.png");
    expect(watermarkedMimeType(false)).toBe("video/mp4");
    expect(watermarkedMimeType(true)).toBe("image/png");
  });
});

describe("every export path routes through the watermark", () => {
  const exportPaths = [
    "src/components/ShareMenu.tsx",
    "src/components/FullVideoShareMenu.tsx",
    "src/routes/offline.tsx",
  ];

  for (const path of exportPaths) {
    it(`${path} watermarks before downloading`, () => {
      const src = read(path);
      expect(src).toContain("prepareWatermarkedFile");
      // No raw blob download may remain in an export path.
      expect(src).not.toMatch(/a\.download\s*=/);
      expect(src).not.toMatch(/new File\(\[blob\]/);
    });
  }

  it("the share-sheet file is the watermarked file", () => {
    for (const path of ["src/components/ShareMenu.tsx", "src/components/FullVideoShareMenu.tsx"]) {
      const src = read(path);
      // The first tap must finish Smart Watermark before exposing the Save
      // action. Only that prepared file can reach the second tap's share sheet.
      expect(src).toMatch(
        /const file = await prepareWatermarkedFile\([\s\S]*?setReadyFile\(file\)/,
      );
      expect(src).toContain("await navigator.share({ files: [readyFile] })");
      expect(src).not.toMatch(/setReadyFile\((?!file\)|null\))/);
    }
  });

  it("the JSON data export is left alone", () => {
    const src = read("src/components/MoreSettings.tsx");
    expect(src).toContain('a.download = "coolerup-data.json"');
    expect(src).not.toContain("prepareWatermarkedFile");
  });

  it("the offline page no longer opens a raw blob in a new tab", () => {
    const src = read("src/routes/offline.tsx");
    expect(src).not.toMatch(/window\.open\(url/);
  });
});
