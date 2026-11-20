import { describe, expect, it } from "vitest";
import { buildFacebookEmbedUrl, normalizeFacebookVideoUrl } from "./facebook";

describe("facebook embed", () => {
  it("accepts facebook video links", () => {
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/watch/?v=123&x=1")).toBe("https://www.facebook.com/watch/?v=123");
    expect(normalizeFacebookVideoUrl("https://fb.watch/abc123/")).toBe("https://fb.watch/abc123/");
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/page/videos/456")).toContain("/videos/456");
  });
  it("rejects other hosts", () => {
    expect(normalizeFacebookVideoUrl("https://evil.com/watch/?v=1")).toBeNull();
    expect(normalizeFacebookVideoUrl("javascript:alert(1)")).toBeNull();
  });
  it("builds the official plugin url", () => {
    expect(buildFacebookEmbedUrl("https://fb.watch/a/")).toMatch(/^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
  });
});
