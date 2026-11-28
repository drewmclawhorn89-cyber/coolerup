import { beforeEach, describe, expect, it, vi } from "vitest";
import { hasExistingWatermark, watermarkSampleTimes } from "@/lib/existingWatermark";
import { prepareWatermarkedFile, WatermarkError, watermarkCornerAtTime } from "@/lib/watermark";

vi.mock("@/lib/existingWatermark", async (original) => ({
  ...await original<typeof import("@/lib/existingWatermark")>(),
  detectExistingVideoWatermark: vi.fn(),
}));
import { detectExistingVideoWatermark } from "@/lib/existingWatermark";

beforeEach(() => vi.resetAllMocks());

describe("Smart Watermark", () => {
  it.each(["TikTok", "Instagram", "YouTube", "Snapchat", "Kwai"])("recognizes an existing %s stamp", (text) => {
    expect(hasExistingWatermark([{ text, confidence: 85 }])).toBe(true);
  });
  it("recognizes an unfamiliar recurring creator stamp", () => {
    expect(hasExistingWatermark([{ text: "@other_creator", confidence: 90 }, { text: "@other_creator", confidence: 80 }])).toBe(true);
    expect(hasExistingWatermark([{ text: "@other_creator", confidence: 90 }])).toBe(false);
  });
  it("does not classify ordinary corner text as a watermark", () => {
    expect(hasExistingWatermark([{ text: "Summer at the beach", confidence: 90 }])).toBe(false);
    expect(hasExistingWatermark([{ text: "TikTok", confidence: 10 }])).toBe(false);
  });
  it("preserves marked video bytes, filename and type exactly", async () => {
    vi.mocked(detectExistingVideoWatermark).mockResolvedValue(true);
    const blob = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "video/webm" });
    const file = await prepareWatermarkedFile({ blob, filename: "original.webm", username: "drew" });
    expect(file.name).toBe("original.webm");
    expect(file.type).toBe("video/webm");
    const bytes = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.readAsDataURL(file);
    });
    expect(bytes).toBe("data:video/webm;base64,AQIDBA==");
  });
  it("never exports unchecked bytes after detection fails", async () => {
    vi.mocked(detectExistingVideoWatermark).mockRejectedValue(new Error("Unreadable video"));
    await expect(prepareWatermarkedFile({ blob: new Blob(["clip"], { type: "video/mp4" }), filename: "clip.mp4", username: "drew" })).rejects.toBeInstanceOf(WatermarkError);
  });
  it("a clean video still requires encoding, not an original-byte fallback", async () => {
    vi.mocked(detectExistingVideoWatermark).mockResolvedValue(false);
    await expect(prepareWatermarkedFile({ blob: new Blob(["invalid clip"], { type: "video/mp4" }), filename: "clip.mp4", username: "drew" })).rejects.toBeInstanceOf(WatermarkError);
  });
  it("moves Coolerup to a different corner every three seconds", () => {
    expect([0, 3, 6, 9, 12].map(watermarkCornerAtTime)).toEqual(["top-left", "top-right", "bottom-right", "bottom-left", "top-left"]);
  });
  it("samples both early moving marks and the end", () => {
    expect(watermarkSampleTimes(12)).toEqual([0.15, 3.3, 6.3, 6, 11.9]);
    expect(() => watermarkSampleTimes(Infinity)).toThrow();
  });
});