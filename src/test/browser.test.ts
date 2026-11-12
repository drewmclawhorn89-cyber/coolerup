import { describe, expect, it } from "vitest";

import {
  BROWSER_SITES,
  GOOGLE_IMAGES,
  GOOGLE_SEARCH,
  displayTitle,
  isAllowedDownload,
  isBlockedUrl,
  isEmbeddable,
  parseInput,
  siteById,
  urlForSite,
  youtubeIdFromBrowserUrl,
  youtubeIdFromInput,
} from "@/lib/browser";

describe("parseInput", () => {
  it("treats empty input as empty", () => {
    expect(parseInput("   ")).toEqual({ kind: "empty" });
  });

  it("keeps a full https URL as a URL", () => {
    expect(parseInput("https://example.com/a?b=1")).toEqual({
      kind: "url",
      url: "https://example.com/a?b=1",
    });
  });

  it("promotes a bare domain to https", () => {
    expect(parseInput("youtube.com")).toEqual({ kind: "url", url: "https://youtube.com" });
    expect(parseInput("wikipedia.org/wiki/Cat")).toEqual({
      kind: "url",
      url: "https://wikipedia.org/wiki/Cat",
    });
  });

  it("turns a phrase into a Google search", () => {
    const parsed = parseInput("mgk starman");
    expect(parsed.kind).toBe("search");
    if (parsed.kind !== "search") return;
    expect(parsed.query).toBe("mgk starman");
    expect(parsed.url).toContain("google.com/search");
    expect(parsed.url).toContain("igu=1");
    expect(parsed.url).toContain("safe=active");
  });
});

describe("Google helpers", () => {
  it("forces SafeSearch and embeddable mode", () => {
    expect(GOOGLE_SEARCH("cats")).toBe("https://www.google.com/search?igu=1&safe=active&q=cats");
    expect(GOOGLE_IMAGES("dogs")).toContain("tbm=isch");
    expect(GOOGLE_IMAGES("dogs")).toContain("safe=active");
  });
});

describe("site tabs", () => {
  it("exposes the seven requested sites", () => {
    expect(BROWSER_SITES.map((s) => s.id)).toEqual([
      "google",
      "youtube",
      "tiktok",
      "wikipedia",
      "news",
      "images",
      "maps",
    ]);
  });

  it("builds a search URL when there is a query and the home otherwise", () => {
    const youtube = siteById("youtube")!;
    expect(urlForSite(youtube, "mgk")).toContain("youtube.com/results?search_query=mgk");
    expect(urlForSite(youtube)).toBe("https://www.youtube.com");
  });
});

describe("safety", () => {
  it("blocks adult domains and subdomains", () => {
    expect(isBlockedUrl("https://www.pornhub.com/view")).toBe(true);
    expect(isBlockedUrl("https://m.xvideos.com/x")).toBe(true);
  });

  it("blocks dangerous file types", () => {
    expect(isBlockedUrl("https://example.com/app.apk")).toBe(true);
    expect(isBlockedUrl("https://example.com/setup.EXE")).toBe(true);
  });

  it("allows ordinary pages", () => {
    expect(isBlockedUrl("https://en.wikipedia.org/wiki/Cat")).toBe(false);
  });

  it("does not mistake a .com domain for a .com file", () => {
    expect(isBlockedUrl("https://www.youtube.com")).toBe(false);
    expect(isBlockedUrl("https://example.com/page")).toBe(false);
  });

  it("only lets images leave the sandbox", () => {
    expect(isAllowedDownload("https://x.com/a.png")).toBe(true);
    expect(isAllowedDownload("https://x.com/a.jpg?w=1")).toBe(true);
    expect(isAllowedDownload("https://x.com/a.apk")).toBe(false);
    expect(isAllowedDownload("https://x.com/a.pdf")).toBe(false);
  });
});

describe("isEmbeddable", () => {
  it("rejects hosts known to refuse framing", () => {
    expect(isEmbeddable("https://www.youtube.com/watch?v=abc")).toBe(false);
    expect(isEmbeddable("https://www.tiktok.com/@x")).toBe(false);
    expect(isEmbeddable("https://www.instagram.com/x")).toBe(false);
  });

  it("lets Google's frame-friendly endpoints through", () => {
    expect(isEmbeddable(GOOGLE_SEARCH("cats"))).toBe(true);
    expect(isEmbeddable("https://www.google.com/webhp?igu=1")).toBe(true);
    expect(isEmbeddable("https://www.google.com/maps")).toBe(true);
  });

  it("allows sites that do not block framing", () => {
    expect(isEmbeddable("https://en.wikipedia.org/wiki/Cat")).toBe(true);
  });
});

describe("YouTube detection", () => {
  it("reads ids from watch, shorts, youtu.be and embed links", () => {
    expect(youtubeIdFromBrowserUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "dQw4w9WgXcQ",
    );
    expect(youtubeIdFromBrowserUrl("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeIdFromBrowserUrl("https://www.youtube.com/shorts/abc123")).toBe("abc123");
    expect(youtubeIdFromBrowserUrl("https://www.youtube.com/embed/abc123")).toBe("abc123");
  });

  it("returns null for non-YouTube URLs", () => {
    expect(youtubeIdFromBrowserUrl("https://example.com/watch?v=x")).toBeNull();
    expect(youtubeIdFromInput("mgk starman")).toBeNull();
  });

  it("finds a pasted YouTube link typed into the pill", () => {
    expect(youtubeIdFromInput("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
  });
});

describe("displayTitle", () => {
  it("shows the host, stripping www", () => {
    expect(displayTitle("https://www.youtube.com/watch?v=1")).toBe("youtube.com");
    expect(displayTitle("not a url")).toBe("New tab");
  });
});
