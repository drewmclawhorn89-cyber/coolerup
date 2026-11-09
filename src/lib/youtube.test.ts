import { describe, expect, it } from "vitest";
import { extractYouTubeId, youtubeThumbnail } from "./youtube";

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