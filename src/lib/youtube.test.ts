import { describe, expect, it } from "vitest";
import { extractYouTubeId, parseIsoDuration, parseYouTubeDuration, youtubeThumbnail } from "./youtube";

describe("YouTube links", () => {
  it("extracts the video ID from the requested watch URL", () => {
    expect(extractYouTubeId("https://youtube.com/watch?v=abc123")).toBe("abc123");
    expect(youtubeThumbnail("abc123")).toBe("https://i.ytimg.com/vi/abc123/hqdefault.jpg");
  });
  it("accepts share, shorts and embed links", () => {
    for (const url of ["https://youtu.be/abc123?t=1", "https://www.youtube.com/shorts/abc123", "https://www.youtube.com/embed/abc123"]) {
      expect(extractYouTubeId(url)).toBe("abc123");
    }
  });
  it("rejects untrusted hosts, scripts, missing IDs and unsafe IDs", () => {
    for (const url of ["https://youtube.com.evil.test/watch?v=abc123", "javascript:alert(1)", "https://youtube.com/watch", "https://youtube.com/watch?v=abc%22%3E", "not a link"]) {
      expect(extractYouTubeId(url)).toBeNull();
    }
  });
});
describe("YouTube durations", () => {
  it("reads lengthSeconds out of the player config", () => {
    const html = '..."videoDetails":{"videoId":"abc123","lengthSeconds":"754"...';
    expect(parseYouTubeDuration(html)).toBe(754);
  });
  it("falls back to approxDurationMs", () => {
    expect(parseYouTubeDuration('"approxDurationMs":"3725000"')).toBe(3725);
  });
  it("falls back to the ISO 8601 microdata duration", () => {
    expect(parseYouTubeDuration('<meta itemprop="duration" content="PT1H2M5S">')).toBe(3725);
    expect(parseYouTubeDuration('"duration":"PT12M34S"')).toBe(754);
  });
  it("returns null for live streams, consent walls and junk", () => {
    for (const html of ["", "<html>Before you continue</html>", '"lengthSeconds":"0"', '"approxDurationMs":"0"']) {
      expect(parseYouTubeDuration(html)).toBeNull();
    }
  });
  it("parses ISO durations directly", () => {
    expect(parseIsoDuration("PT45S")).toBe(45);
    expect(parseIsoDuration("PT2H")).toBe(7200);
    expect(parseIsoDuration("P1DT1S")).toBe(86401);
    expect(parseIsoDuration("PT0S")).toBeNull();
    expect(parseIsoDuration("nonsense")).toBeNull();
  });
});
