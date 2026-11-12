import { describe, expect, it } from "vitest";

import {
  COOLERUP_TABS,
  displayTitle,
  embedUrlFor,
  GOOGLE_IMAGES,
  GOOGLE_SEARCH,
  hostLabel,
  isAllowedDownload,
  isBlockedUrl,
  isEmbeddable,
  isInternalUrl,
  parseInput,
  prettyUrl,
  SHORTCUTS,
  siteById,
  stripEdges,
  stripMaxScroll,
  stripStep,
  tiktokVideoId,
  urlForSite,
  youtubeIdFromBrowserUrl,
  youtubeIdFromInput,
} from "@/lib/coolerupBrowser";

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

  it("turns a phrase into a Coolerup search, not a Google URL", () => {
    expect(parseInput("mgk starman")).toEqual({ kind: "search", query: "mgk starman" });
  });
});

describe("Google helpers", () => {
  it("forces SafeSearch and embeddable mode", () => {
    expect(GOOGLE_SEARCH("cats")).toBe("https://www.google.com/search?igu=1&safe=active&q=cats");
    expect(GOOGLE_IMAGES("dogs")).toContain("tbm=isch");
    expect(GOOGLE_IMAGES("dogs")).toContain("safe=active");
  });
});

describe("Coolerup tabs", () => {
  it("exposes the seven requested tabs, starting with Coolerup", () => {
    expect(COOLERUP_TABS.map((s) => s.id)).toEqual([
      "coolerup",
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

  it("points the Coolerup tab at the internal home page", () => {
    const home = siteById("coolerup")!;
    expect(isInternalUrl(home.home)).toBe(true);
  });
});

describe("home shortcuts", () => {
  it("offers the six requested cards", () => {
    expect(SHORTCUTS.map((s) => s.id)).toEqual([
      "youtube",
      "tiktok",
      "wikipedia",
      "news",
      "music",
      "shop",
    ]);
  });

  it("keeps Music and Shop inside the app", () => {
    expect(SHORTCUTS.find((s) => s.id === "music")?.internal).toBe(true);
    expect(SHORTCUTS.find((s) => s.id === "shop")?.internal).toBe(true);
    expect(SHORTCUTS.find((s) => s.id === "youtube")?.internal).toBeFalsy();
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
    expect(isEmbeddable("https://www.instagram.com/x")).toBe(false);
    expect(isEmbeddable("https://www.reddit.com/r/all")).toBe(false);
  });

  it("lets Google's frame-friendly endpoints through", () => {
    expect(isEmbeddable(GOOGLE_SEARCH("cats"))).toBe(true);
    expect(isEmbeddable("https://www.google.com/webhp?igu=1")).toBe(true);
    expect(isEmbeddable("https://www.google.com/maps")).toBe(true);
  });

  it("allows sites that do not block framing", () => {
    expect(isEmbeddable("https://en.wikipedia.org/wiki/Cat")).toBe(true);
  });

  it("never frames internal Coolerup pages", () => {
    expect(isEmbeddable("coolerup://home")).toBe(false);
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

describe("display helpers", () => {
  it("shows the host, stripping www", () => {
    expect(displayTitle("https://www.youtube.com/watch?v=1")).toBe("youtube.com");
    expect(displayTitle("not a url")).toBe("New tab");
  });

  it("labels internal pages as Coolerup", () => {
    expect(displayTitle("coolerup://home")).toBe("Coolerup");
  });

  it("formats a host and pretty URL for result cards", () => {
    expect(hostLabel("https://en.wikipedia.org/wiki/Cat")).toBe("en.wikipedia.org");
    expect(prettyUrl("https://en.wikipedia.org/wiki/Cat")).toBe("en.wikipedia.org/wiki/Cat");
  });
});

describe("inline players", () => {
  it("turns a YouTube link into an embeddable player", () => {
    expect(embedUrlFor("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(
      "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1",
    );
    expect(embedUrlFor("https://youtu.be/dQw4w9WgXcQ")).toContain("/embed/dQw4w9WgXcQ");
  });

  it("turns a TikTok video link into an embeddable player", () => {
    const url = "https://www.tiktok.com/@scout2015/video/6718335390845095173";
    expect(tiktokVideoId(url)).toBe("6718335390845095173");
    expect(embedUrlFor(url)).toBe("https://www.tiktok.com/embed/v2/6718335390845095173");
  });

  it("returns null when there is no video", () => {
    expect(embedUrlFor("https://www.tiktok.com/@tiktok")).toBeNull();
    expect(embedUrlFor("https://example.com/post")).toBeNull();
  });

  it("treats player URLs as embeddable even though the host blocks framing", () => {
    expect(isEmbeddable("https://www.tiktok.com/@a/video/6718335390845095173")).toBe(true);
    expect(isEmbeddable("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe(true);
  });
});

describe("proxy-first framing", () => {
  it("sends ordinary sites through the Coolerup proxy", () => {
    expect(isEmbeddable("https://www.theverge.com/")).toBe(false);
    expect(isEmbeddable("https://www.imdb.com/title/tt0111161/")).toBe(false);
  });

  it("still frames the handful of hosts that allow it", () => {
    expect(isEmbeddable("https://en.wikipedia.org/wiki/Cat")).toBe(true);
    expect(isEmbeddable("https://www.openstreetmap.org/")).toBe(true);
  });
});

describe("top tab strip", () => {
  // Seven taps, ~78px each, in a 200px window: only the first two and a bit fit.
  const tabs = Array.from({ length: 7 }, (_, i) => ({ left: i * 78, width: 78 }));
  const contentWidth = 7 * 78;

  it("knows how far it can scroll", () => {
    expect(stripMaxScroll(contentWidth, 200)).toBe(contentWidth - 200);
    expect(stripMaxScroll(200, 400)).toBe(0);
  });

  it("reports the ends so the arrows can disable themselves", () => {
    expect(stripEdges(0, contentWidth, 200)).toEqual({ atStart: true, atEnd: false });
    expect(stripEdges(stripMaxScroll(contentWidth, 200), contentWidth, 200)).toEqual({
      atStart: false,
      atEnd: true,
    });
    expect(stripEdges(100, contentWidth, 200)).toEqual({ atStart: false, atEnd: false });
  });

  it("steps right to the first tab that is not fully visible", () => {
    // 0..200 shows tabs 0 and 1 fully (tab 1 ends at 156), tab 2 is clipped.
    expect(stripStep(tabs, 200, 0, "right")).toEqual({ scrollLeft: 156, index: 2 });
  });

  it("steps left back to the previous hidden tab", () => {
    expect(stripStep(tabs, 200, 156, "left")).toEqual({ scrollLeft: 78, index: 1 });
    expect(stripStep(tabs, 200, 78, "left")).toEqual({ scrollLeft: 0, index: 0 });
  });

  it("clamps at both ends instead of scrolling into empty space", () => {
    const max = stripMaxScroll(contentWidth, 200);
    expect(stripStep(tabs, 200, 0, "left").scrollLeft).toBe(0);
    expect(stripStep(tabs, 200, max, "right").scrollLeft).toBe(max);
  });

  it("walks all the way to the last tab", () => {
    let scrollLeft = 0;
    const visited = new Set<number>([0]);
    for (let i = 0; i < 10; i += 1) {
      const next = stripStep(tabs, 200, scrollLeft, "right");
      visited.add(next.index);
      if (next.scrollLeft === scrollLeft) break;
      scrollLeft = next.scrollLeft;
    }
    expect(visited.has(6)).toBe(true);
  });
});
