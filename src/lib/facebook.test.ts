import { describe, expect, it } from "vitest";
import { buildFacebookEmbedUrl, normalizeFacebookVideoUrl } from "./facebook";

describe("facebook embed", () => {
  it("accepts the common facebook link shapes", () => {
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/watch/?v=123&fbclid=x")).toBe("https://www.facebook.com/watch/?v=123");
    expect(normalizeFacebookVideoUrl("https://fb.watch/abc123/")).toBe("https://fb.watch/abc123/");
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/page/videos/456")).toContain("/videos/456");
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/share/v/1AbCdE/?mibextid=wwXIfr")).toBe("https://www.facebook.com/share/v/1AbCdE/");
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/share/r/1AbCdE/")).toContain("/share/r/");
    expect(normalizeFacebookVideoUrl("https://m.facebook.com/reel/789")).toBe("https://www.facebook.com/reel/789");
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/user/posts/pfbid0abc")).toContain("/posts/");
  });
  it("tolerates surrounding text and missing scheme", () => {
    expect(normalizeFacebookVideoUrl("look https://fb.watch/xyz/ lol")).toBe("https://fb.watch/xyz/");
    expect(normalizeFacebookVideoUrl("facebook.com/reel/789")).toBe("https://www.facebook.com/reel/789");
  });
  it("rejects other hosts and the bare homepage", () => {
    expect(normalizeFacebookVideoUrl("https://evil.com/watch/?v=1")).toBeNull();
    expect(normalizeFacebookVideoUrl("https://facebook.com.evil.com/reel/1")).toBeNull();
    expect(normalizeFacebookVideoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/")).toBeNull();
  });
  it("builds the official plugin url", () => {
    expect(buildFacebookEmbedUrl("https://fb.watch/a/")).toMatch(/^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/);
  });
});
