import { describe, expect, it } from "vitest";
import { buildFacebookEmbedUrl, normalizeFacebookVideoUrl } from "./facebook";

describe("facebook embed", () => {
  it("accepts the common facebook link shapes", () => {
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/watch/?v=123&fbclid=x")).toBe(
      "https://www.facebook.com/watch/?v=123",
    );
    expect(normalizeFacebookVideoUrl("https://fb.watch/abc123/")).toBe("https://fb.watch/abc123/");
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/page/videos/456")).toContain(
      "/videos/456",
    );
    expect(
      normalizeFacebookVideoUrl("https://www.facebook.com/share/v/1AbCdE/?mibextid=wwXIfr"),
    ).toBe("https://www.facebook.com/share/v/1AbCdE/");
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/share/r/1AbCdE/")).toContain(
      "/share/r/",
    );
    expect(normalizeFacebookVideoUrl("https://m.facebook.com/reel/789")).toBe(
      "https://www.facebook.com/reel/789",
    );
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/user/posts/pfbid0abc")).toContain(
      "/posts/",
    );
  });
  it("tolerates surrounding text and missing scheme", () => {
    expect(normalizeFacebookVideoUrl("look https://fb.watch/xyz/ lol")).toBe(
      "https://fb.watch/xyz/",
    );
    expect(normalizeFacebookVideoUrl("facebook.com/reel/789")).toBe(
      "https://www.facebook.com/reel/789",
    );
  });
  it("rejects other hosts and the bare homepage", () => {
    expect(normalizeFacebookVideoUrl("https://evil.com/watch/?v=1")).toBeNull();
    expect(normalizeFacebookVideoUrl("https://facebook.com.evil.com/reel/1")).toBeNull();
    expect(normalizeFacebookVideoUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeFacebookVideoUrl("https://www.facebook.com/")).toBeNull();
  });
  it("builds the official plugin url", () => {
    expect(buildFacebookEmbedUrl("https://fb.watch/a/")).toMatch(
      /^https:\/\/www\.facebook\.com\/plugins\/video\.php\?href=/,
    );
  });
});

import {
  extractFacebookCanonical,
  needsFacebookResolve,
  unwrapFacebookLoginRedirect,
} from "./facebook";
describe("facebook link resolving", () => {
  it("detects share and fb.watch links", () => {
    expect(needsFacebookResolve("https://www.facebook.com/share/v/1Ab/")).toBe(true);
    expect(needsFacebookResolve("https://fb.watch/abc/")).toBe(true);
    expect(needsFacebookResolve("https://www.facebook.com/watch/?v=1")).toBe(false);
  });
  it("unwraps login redirects", () => {
    const real = "https://www.facebook.com/reel/123";
    expect(
      unwrapFacebookLoginRedirect(
        `https://www.facebook.com/login/?next=${encodeURIComponent(real)}`,
      ),
    ).toBe(real);
    expect(unwrapFacebookLoginRedirect(real)).toBe(real);
  });
  it("reads og:url", () => {
    expect(
      extractFacebookCanonical(
        '<meta property="og:url" content="https://www.facebook.com/reel/9?a=1&b=2" />',
      ),
    ).toBe("https://www.facebook.com/reel/9?a=1&b=2");
    expect(extractFacebookCanonical("<html></html>")).toBeNull();
  });
});

import {
  FACEBOOK_HOME_URL,
  formatFacebookDisplayUrl,
  isMobileFacebookUrl,
  resolveFacebookBarInput,
  setFacebookHostMode,
} from "./facebook";
import { ProxyCookieJar, isFacebookFamilyHost, isMobilePreferredHost } from "./proxyCookies";

describe("facebook in-app browser helpers", () => {
  it("swaps between mobile and desktop Facebook hosts while keeping path", () => {
    expect(setFacebookHostMode("https://www.facebook.com/watch/?v=42", true)).toBe(
      "https://m.facebook.com/watch/?v=42",
    );
    expect(setFacebookHostMode("https://m.facebook.com/reel/99", false)).toBe(
      "https://www.facebook.com/reel/99",
    );
    expect(isMobileFacebookUrl(FACEBOOK_HOME_URL)).toBe(true);
    expect(isMobileFacebookUrl("https://www.facebook.com/")).toBe(false);
  });

  it("resolves links and search queries inside the Facebook tab", () => {
    expect(resolveFacebookBarInput("https://www.facebook.com/watch/?v=123", true)).toBe(
      "https://m.facebook.com/watch/?v=123",
    );
    expect(resolveFacebookBarInput("funny cats", true)).toBe(
      "https://m.facebook.com/search/top/?q=funny%20cats",
    );
    expect(resolveFacebookBarInput("   ", true)).toBeNull();
    expect(formatFacebookDisplayUrl("https://m.facebook.com/watch/")).toBe("m.facebook.com/watch/");
  });
});

describe("proxyCookies jar", () => {
  it("isolates sessions and enforces domain/path scoping", () => {
    const jar = new ProxyCookieJar();
    const fbUrl = new URL("https://m.facebook.com/login/");
    jar.setFromHeaders("sess-1", fbUrl, [
      "datr=abc123; Domain=.facebook.com; Path=/; HttpOnly; Secure",
      "bad=steal; Domain=.google.com; Path=/",
    ]);

    expect(jar.getCookieHeader("sess-1", new URL("https://www.facebook.com/watch/"))).toBe(
      "datr=abc123",
    );
    expect(jar.getCookieHeader("sess-1", new URL("https://google.com/"))).toBeNull();
    expect(jar.getCookieHeader("sess-2", fbUrl)).toBeNull();
  });

  it("identifies mobile-preferred and Facebook-family hosts", () => {
    expect(isMobilePreferredHost("m.facebook.com")).toBe(true);
    expect(isMobilePreferredHost("www.facebook.com")).toBe(false);
    expect(isFacebookFamilyHost("m.facebook.com")).toBe(true);
    expect(isFacebookFamilyHost("fb.watch")).toBe(true);
    expect(isFacebookFamilyHost("example.com")).toBe(false);
  });
});
