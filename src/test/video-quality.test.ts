import { beforeEach, describe, expect, it } from "vitest";
import {
  QUALITY_OPTIONS,
  QUALITY_PREF_KEY,
  autoRendition,
  createQualityVersions,
  isQualityId,
  qualityColumns,
  qualityUrlKey,
  readQuality,
  resolveQualitySource,
  resolveRendition,
  writeQuality,
  type QualitySources,
} from "@/lib/videoQuality";

const VIDEO: QualitySources = {
  video_url: "storage:original.mp4",
  video_1080_url: "storage:1080.mp4",
  video_720_url: "storage:720.mp4",
  video_480_url: "storage:480.mp4",
  video_360_url: "storage:360.mp4",
};

beforeEach(() => localStorage.clear());

describe("quality preference", () => {
  it("defaults to auto", () => {
    expect(readQuality()).toBe("auto");
  });

  it("round-trips a selection through localStorage", () => {
    writeQuality("720p");
    expect(localStorage.getItem(QUALITY_PREF_KEY)).toBe("720p");
    expect(readQuality()).toBe("720p");
  });

  it("ignores junk and falls back to auto", () => {
    localStorage.setItem(QUALITY_PREF_KEY, "8k");
    expect(readQuality()).toBe("auto");
    expect(isQualityId("8k")).toBe(false);
    expect(isQualityId("data")).toBe(true);
  });

  it("offers Auto, 1080p, 720p, 480p, 360p and Data Saver", () => {
    expect(QUALITY_OPTIONS.map((o) => o.id)).toEqual([
      "auto",
      "1080p",
      "720p",
      "480p",
      "360p",
      "data",
    ]);
  });
});

describe("auto quality by connection", () => {
  it("maps 4g to 1080p, 3g to 720p, slower to 480p", () => {
    expect(autoRendition("4g")).toBe("1080p");
    expect(autoRendition("3g")).toBe("720p");
    expect(autoRendition("2g")).toBe("480p");
    expect(autoRendition("slow-2g")).toBe("480p");
    expect(autoRendition("unknown")).toBe("480p");
  });

  it("Data Saver always means 360p", () => {
    expect(resolveRendition("data", "4g")).toBe("360p");
  });

  it("manual picks win over the network", () => {
    expect(resolveRendition("720p", "2g")).toBe("720p");
  });
});

describe("resolving the source URL", () => {
  it("uses the matching rendition column", () => {
    expect(resolveQualitySource(VIDEO, "1080p").url).toBe("storage:1080.mp4");
    expect(resolveQualitySource(VIDEO, "720p").url).toBe("storage:720.mp4");
    expect(resolveQualitySource(VIDEO, "480p").url).toBe("storage:480.mp4");
    expect(resolveQualitySource(VIDEO, "360p").url).toBe("storage:360.mp4");
    expect(resolveQualitySource(VIDEO, "data").url).toBe("storage:360.mp4");
  });

  it("auto follows the connection", () => {
    expect(resolveQualitySource(VIDEO, "auto", "4g").url).toBe("storage:1080.mp4");
    expect(resolveQualitySource(VIDEO, "auto", "3g").url).toBe("storage:720.mp4");
    expect(resolveQualitySource(VIDEO, "auto", "2g").url).toBe("storage:480.mp4");
  });

  it("falls back to the original upload for older rows", () => {
    const legacy: QualitySources = { video_url: "storage:old.mp4" };
    const got = resolveQualitySource(legacy, "720p");
    expect(got.url).toBe("storage:old.mp4");
    expect(got.fallback).toBe(true);
  });

  it("shows a badge only when a quality was picked by hand", () => {
    expect(resolveQualitySource(VIDEO, "auto", "4g").badge).toBeNull();
    expect(resolveQualitySource(VIDEO, "720p").badge).toBe("720p");
    expect(resolveQualitySource(VIDEO, "data").badge).toBe("Data Saver");
  });

  it("maps each rendition to its column", () => {
    expect(qualityUrlKey("1080p")).toBe("video_1080_url");
    expect(qualityUrlKey("360p")).toBe("video_360_url");
  });
});

describe("upload renditions", () => {
  it("points every quality at the original for now", async () => {
    const urls = await createQualityVersions("storage:abc.mp4");
    expect(urls).toEqual({
      "1080p": "storage:abc.mp4",
      "720p": "storage:abc.mp4",
      "480p": "storage:abc.mp4",
      "360p": "storage:abc.mp4",
    });
  });

  it("spreads into the videos table columns", async () => {
    const cols = qualityColumns(await createQualityVersions("storage:abc.mp4"));
    expect(cols).toEqual({
      video_1080_url: "storage:abc.mp4",
      video_720_url: "storage:abc.mp4",
      video_480_url: "storage:abc.mp4",
      video_360_url: "storage:abc.mp4",
    });
  });
});
