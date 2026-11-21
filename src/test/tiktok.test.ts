import { describe, expect, it } from "vitest";
import {
  extractVideoIdsFromProfileHtml,
  normalizeDisplayApiItem,
  normalizeOEmbed,
  parseTikTokInput,
  shortCaption,
  splitTikTokLinks,
  tiktokEmbedUrl,
  tiktokIdFromEmbed,
  tiktokOEmbedUrl,
} from "@/lib/tiktok";

describe("parseTikTokInput", () => {
  it("reads a standard video URL", () => {
    const ref = parseTikTokInput("https://www.tiktok.com/@scout2015/video/6718335390845095173");
    expect(ref).toEqual({
      kind: "video",
      id: "6718335390845095173",
      handle: "scout2015",
      url: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    });
  });

  it("accepts the mobile host and strips query strings", () => {
    const ref = parseTikTokInput("https://m.tiktok.com/@cats/video/7123456789012345678?lang=en");
    expect(ref?.kind).toBe("video");
    expect(ref && "id" in ref ? ref.id : "").toBe("7123456789012345678");
  });

  it("reads a creator profile URL", () => {
    expect(parseTikTokInput("https://www.tiktok.com/@cats")).toEqual({
      kind: "creator",
      handle: "cats",
      url: "https://www.tiktok.com/@cats",
    });
  });

  it("reads a bare handle with or without @", () => {
    expect(parseTikTokInput("@cats")).toMatchObject({ kind: "creator", handle: "cats" });
    expect(parseTikTokInput("cats")).toMatchObject({ kind: "creator", handle: "cats" });
  });

  it("reads a bare numeric post id", () => {
    expect(parseTikTokInput("6718335390845095173")).toMatchObject({
      kind: "video",
      id: "6718335390845095173",
    });
  });

  it("reads hashtag pages", () => {
    expect(parseTikTokInput("https://www.tiktok.com/tag/slowmoments")).toEqual({
      kind: "hashtag",
      tag: "slowmoments",
      url: "https://www.tiktok.com/tag/slowmoments",
    });
  });

  it("marks short links instead of guessing their target", () => {
    expect(parseTikTokInput("https://vm.tiktok.com/ZMabc123/")).toMatchObject({ kind: "short" });
  });

  it("rejects other hosts, scripts, and junk", () => {
    expect(parseTikTokInput("https://evil.example.com/@a/video/123456789")).toBeNull();
    expect(parseTikTokInput("javascript:alert(1)")).toBeNull();
    expect(parseTikTokInput("")).toBeNull();
    expect(parseTikTokInput("https://www.tiktok.com/@a/video/notanid")).toBeNull();
  });
});

describe("embed and oEmbed URLs", () => {
  it("builds the v2 embed URL", () => {
    expect(tiktokEmbedUrl("6718335390845095173")).toBe(
      "https://www.tiktok.com/embed/v2/6718335390845095173",
    );
  });

  it("encodes the target URL in the oEmbed query", () => {
    const url = tiktokOEmbedUrl("https://www.tiktok.com/@a/video/123456789");
    expect(url.startsWith("https://www.tiktok.com/oembed?url=")).toBe(true);
    expect(url).toContain(encodeURIComponent("https://www.tiktok.com/@a/video/123456789"));
  });

  it("pulls an id out of embed HTML or an embed URL", () => {
    expect(
      tiktokIdFromEmbed('<blockquote cite="https://www.tiktok.com/@a/video/7123456789012345678">'),
    ).toBe("7123456789012345678");
    expect(tiktokIdFromEmbed("https://www.tiktok.com/embed/v2/7123456789012345678")).toBe(
      "7123456789012345678",
    );
  });
});

describe("normalizeOEmbed", () => {
  const payload = {
    version: "1.0",
    type: "video",
    title: "slow morning #slowmoments",
    author_name: "Scout",
    author_url: "https://www.tiktok.com/@scout2015",
    author_unique_id: "scout2015",
    thumbnail_url: "https://p16-sign.tiktokcdn.com/cover.jpg",
    html: '<blockquote cite="https://www.tiktok.com/@scout2015/video/6718335390845095173"></blockquote>',
  };

  it("keeps the caption, handle, cover and canonical URL", () => {
    const meta = normalizeOEmbed(
      payload,
      "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    );
    expect(meta).toMatchObject({
      id: "6718335390845095173",
      title: "slow morning #slowmoments",
      author: "scout2015",
      thumbnailUrl: "https://p16-sign.tiktokcdn.com/cover.jpg",
      url: "https://www.tiktok.com/@scout2015/video/6718335390845095173",
      duration: 0,
    });
  });

  it("falls back to a title and the URL id when the payload is thin", () => {
    const meta = normalizeOEmbed(
      { html: '<blockquote cite="https://www.tiktok.com/@a/video/7123456789012345678">' },
      "https://www.tiktok.com/@a/video/7123456789012345678",
    );
    expect(meta?.title).toBe("TikTok video · 7123456789012345678");
    expect(meta?.author).toBe("tiktok");
  });

  it("refuses payloads with no recoverable id", () => {
    expect(normalizeOEmbed({ title: "x" }, "https://www.tiktok.com/@a")).toBeNull();
    expect(normalizeOEmbed(null, "https://www.tiktok.com/@a")).toBeNull();
  });

  it("drops non-https covers instead of trusting them", () => {
    const meta = normalizeOEmbed(
      { ...payload, thumbnail_url: "javascript:alert(1)" },
      "https://www.tiktok.com/@scout2015/video/6718335390845095173",
    );
    expect(meta?.thumbnailUrl).toBeNull();
  });
});

describe("normalizeDisplayApiItem", () => {
  it("maps the Display API fields", () => {
    const meta = normalizeDisplayApiItem({
      id: "7123456789012345678",
      title: "hello",
      video_description: "a caption",
      cover_image_url: "https://p16-sign.tiktokcdn.com/c.jpg",
      share_url: "https://www.tiktok.com/@cats/video/7123456789012345678",
      duration: 15,
    });
    expect(meta).toMatchObject({
      id: "7123456789012345678",
      title: "a caption",
      author: "cats",
      thumbnailUrl: "https://p16-sign.tiktokcdn.com/c.jpg",
      duration: 15,
    });
  });

  it("rejects an item without a numeric id", () => {
    expect(normalizeDisplayApiItem({ id: "abc" })).toBeNull();
    expect(normalizeDisplayApiItem({})).toBeNull();
  });
});

describe("extractVideoIdsFromProfileHtml", () => {
  it("dedupes ids and respects the limit", () => {
    const html = `
      <a href="/@cats/video/1111111111111111111">a</a>
      <a href="/@cats/video/1111111111111111111">a</a>
      <a href="/@cats/video/2222222222222222222">b</a>
      <a href="/@cats/video/3333333333333333333">c</a>`;
    expect(extractVideoIdsFromProfileHtml(html, 2)).toEqual([
      "1111111111111111111",
      "2222222222222222222",
    ]);
  });

  it("returns nothing on a login wall", () => {
    expect(extractVideoIdsFromProfileHtml("<html>Log in to TikTok</html>")).toEqual([]);
  });
});

describe("shortCaption", () => {
  it("collapses whitespace and truncates with an ellipsis", () => {
    expect(shortCaption("  a   b  ")).toBe("a b");
    expect(shortCaption("abcdef", 4)).toBe("abc…");
  });
});

describe("splitTikTokLinks", () => {
  it("splits on newlines, commas and spaces", () => {
    expect(
      splitTikTokLinks(
        "https://www.tiktok.com/@a/video/1111111111111111111\nhttps://www.tiktok.com/@b/video/2222222222222222222, 3333333333333333333",
      ),
    ).toEqual([
      "https://www.tiktok.com/@a/video/1111111111111111111",
      "https://www.tiktok.com/@b/video/2222222222222222222",
      "3333333333333333333",
    ]);
  });

  it("ignores blank input", () => {
    expect(splitTikTokLinks("   \n\n  ")).toEqual([]);
  });
});
