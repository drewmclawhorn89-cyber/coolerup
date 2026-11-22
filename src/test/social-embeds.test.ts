import { describe, expect, it } from "vitest";
import {
  SOCIAL_APPS,
  buildSocialEmbed,
  facebookTarget,
  instagramShortcode,
  socialApp,
  tiktokVideoId,
  twitchChannel,
  tweetId,
  xHandle,
  youtubeVideoId,
} from "@/lib/socialEmbeds";

/**
 * The More page must only ever point at a network's own embed player. These
 * tests pin the exact URLs so a future refactor can't quietly swap in a
 * downloader or a proxy.
 */
describe("More page app list", () => {
  it("lists every social app in the requested order", () => {
    expect(SOCIAL_APPS.map((app) => app.name)).toEqual([
      "Facebook",
      "TikTok",
      "Twitch",
      "X",
      "Instagram",
      "YouTube",
      "Snapchat",
      "Reddit",
      "Pinterest",
    ]);
  });

  it("marks only the six embed-capable networks as embeddable", () => {
    expect(SOCIAL_APPS.filter((app) => app.embeddable).map((app) => app.id)).toEqual([
      "facebook",
      "tiktok",
      "twitch",
      "x",
      "instagram",
      "youtube",
    ]);
  });
});

describe("link parsing", () => {
  it("reads YouTube videos, Shorts and raw ids", () => {
    expect(youtubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://youtu.be/dQw4w9WgXcQ?t=3")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://www.youtube.com/shorts/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
    expect(youtubeVideoId("https://vimeo.com/12345")).toBeNull();
  });

  it("reads TikTok video ids", () => {
    expect(tiktokVideoId("https://www.tiktok.com/@tiktok/video/6718335390845095173")).toBe(
      "6718335390845095173",
    );
    expect(tiktokVideoId("6718335390845095173")).toBe("6718335390845095173");
    expect(tiktokVideoId("https://www.tiktok.com/@tiktok")).toBeNull();
  });

  it("reads X posts and handles", () => {
    expect(tweetId("https://x.com/jack/status/20")).toBe("20");
    expect(tweetId("https://twitter.com/jack/status/20?s=20")).toBe("20");
    expect(tweetId("https://x.com/jack")).toBeNull();
    expect(xHandle("https://x.com/nasa")).toBe("nasa");
    expect(xHandle("@nasa")).toBe("nasa");
    expect(xHandle("nasa")).toBe("nasa");
  });

  it("reads Instagram posts and reels", () => {
    expect(instagramShortcode("https://www.instagram.com/p/BsOGulcndj-/")).toEqual({
      kind: "p",
      code: "BsOGulcndj-",
    });
    expect(instagramShortcode("https://www.instagram.com/reel/CzGK4P_Rq9o/")).toEqual({
      kind: "reel",
      code: "CzGK4P_Rq9o",
    });
    expect(instagramShortcode("https://www.instagram.com/instagram/")).toBeNull();
  });

  it("separates Facebook pages from Facebook videos", () => {
    expect(facebookTarget("https://www.facebook.com/facebook")).toEqual({
      kind: "page",
      url: "https://www.facebook.com/facebook",
    });
    expect(facebookTarget("https://www.facebook.com/watch/?v=1234567890")?.kind).toBe("video");
    expect(facebookTarget("https://www.facebook.com/reel/1234567890")?.kind).toBe("video");
  });

  it("reads Twitch channels", () => {
    expect(twitchChannel("https://www.twitch.tv/twitch")).toBe("twitch");
    expect(twitchChannel("twitch")).toBe("twitch");
    expect(twitchChannel("https://www.twitch.tv/directory")).toBeNull();
  });
});

describe("official embed URLs", () => {
  it("uses the YouTube embed player", () => {
    const result = buildSocialEmbed(socialApp("youtube"), "https://youtu.be/dQw4w9WgXcQ");
    expect(result).toEqual({
      kind: "embed",
      url: "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0&playsinline=1&modestbranding=1",
      ratio: "video",
    });
  });

  it("uses the TikTok embed player", () => {
    const result = buildSocialEmbed(
      socialApp("tiktok"),
      "https://www.tiktok.com/@tiktok/video/6718335390845095173",
    );
    expect(result).toEqual({
      kind: "embed",
      url: "https://www.tiktok.com/embed/v2/6718335390845095173",
      ratio: "portrait",
    });
  });

  it("uses the X post embed and the X timeline embed", () => {
    expect(buildSocialEmbed(socialApp("x"), "https://x.com/jack/status/20")).toEqual({
      kind: "embed",
      url: "https://platform.twitter.com/embed/Tweet.html?dnt=true&theme=dark&id=20",
      ratio: "feed",
    });
    expect(buildSocialEmbed(socialApp("x"), "@nasa")).toEqual({
      kind: "embed",
      url: "https://syndication.twitter.com/srv/timeline-profile/screen-name/nasa?showReplies=false&theme=dark&lang=en",
      ratio: "feed",
    });
  });

  it("uses the Instagram embed player", () => {
    expect(
      buildSocialEmbed(socialApp("instagram"), "https://www.instagram.com/p/BsOGulcndj-/"),
    ).toEqual({
      kind: "embed",
      url: "https://www.instagram.com/p/BsOGulcndj-/embed/captioned/",
      ratio: "portrait",
    });
  });

  it("uses the Facebook page plugin and video plugin", () => {
    const page = buildSocialEmbed(socialApp("facebook"), "https://www.facebook.com/facebook");
    expect(page.kind).toBe("embed");
    if (page.kind === "embed") {
      expect(page.url.startsWith("https://www.facebook.com/plugins/page.php?href=")).toBe(true);
      expect(page.url).toContain("tabs=timeline");
    }

    const video = buildSocialEmbed(
      socialApp("facebook"),
      "https://www.facebook.com/reel/1234567890",
    );
    expect(video.kind).toBe("embed");
    if (video.kind === "embed") {
      expect(video.url.startsWith("https://www.facebook.com/plugins/video.php?href=")).toBe(true);
    }
  });

  it("uses the Twitch player with a parent for the current host", () => {
    const result = buildSocialEmbed(socialApp("twitch"), "https://www.twitch.tv/twitch");
    expect(result.kind).toBe("embed");
    if (result.kind === "embed") {
      expect(result.url.startsWith("https://player.twitch.tv/?channel=twitch&")).toBe(true);
      expect(result.url).toContain("parent=localhost");
    }
  });

  it("asks for a link instead of guessing when the input is empty", () => {
    expect(buildSocialEmbed(socialApp("youtube"), "").kind).toBe("needs-link");
    expect(buildSocialEmbed(socialApp("instagram"), "https://example.com/post").kind).toBe(
      "needs-link",
    );
  });

  it("reports apps without an official embed as unsupported", () => {
    for (const id of ["snapchat", "reddit", "pinterest"] as const) {
      expect(buildSocialEmbed(socialApp(id), "https://example.com")).toEqual({
        kind: "unsupported",
      });
    }
  });
});
