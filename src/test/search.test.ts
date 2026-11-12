import { describe, expect, it } from "vitest";
import {
  extractHashtags,
  filterLiveHosts,
  hashtagsFromVideos,
  isSearchable,
  MAX_QUERY_LENGTH,
  normalizeQuery,
  sanitizeLike,
  SEARCH_TABS,
  TRENDING_SEARCHES,
} from "@/lib/search";
import type { Video } from "@/lib/loop";

function video(partial: Partial<Video>): Video {
  return {
    id: partial.id ?? "v1",
    username: partial.username ?? "ana",
    caption: partial.caption ?? "",
    video_url: partial.video_url ?? "https://example.com/a.mp4",
    likes_count: partial.likes_count ?? 0,
    comments_count: 0,
    shares_count: 0,
    created_at: partial.created_at ?? new Date().toISOString(),
  };
}

describe("search query helpers", () => {
  it("normalizes whitespace and caps length", () => {
    expect(normalizeQuery("  funny   cats  ")).toBe("funny cats");
    expect(normalizeQuery(null)).toBe("");
    expect(normalizeQuery("x".repeat(MAX_QUERY_LENGTH + 20))).toHaveLength(MAX_QUERY_LENGTH);
  });

  it("strips PostgREST syntax and LIKE wildcards", () => {
    expect(sanitizeLike("#fyp")).toBe("fyp");
    expect(sanitizeLike("@ana")).toBe("ana");
    expect(sanitizeLike("cats, dogs (and %more_)")).toBe("cats dogs and more");
  });

  it("knows when a term is worth querying", () => {
    expect(isSearchable("   ")).toBe(false);
    expect(isSearchable("#")).toBe(false);
    expect(isSearchable("cat")).toBe(true);
  });

  it("exposes the six TikTok tabs in order", () => {
    expect(SEARCH_TABS.map((tab) => tab.id)).toEqual([
      "top",
      "videos",
      "users",
      "sounds",
      "hashtags",
      "live",
    ]);
    expect(TRENDING_SEARCHES.length).toBeGreaterThan(0);
  });
});

describe("hashtags", () => {
  it("extracts lowercased, de-duplicated hashtags from captions", () => {
    expect(extractHashtags("Best #FYP ever #fyp #Cats_2025")).toEqual(["fyp", "cats_2025"]);
    expect(extractHashtags("no tags here")).toEqual([]);
    expect(extractHashtags(null)).toEqual([]);
  });

  it("counts hashtags across videos, most-used first", () => {
    const rows = [
      video({ id: "a", caption: "#fyp #cats" }),
      video({ id: "b", caption: "#fyp" }),
      video({ id: "c", caption: "#dogs #fyp" }),
    ];
    expect(hashtagsFromVideos(rows)).toEqual([
      { tag: "fyp", videos: 3 },
      { tag: "cats", videos: 1 },
      { tag: "dogs", videos: 1 },
    ]);
  });
});

describe("filterLiveHosts", () => {
  const hosts = [
    { userId: "u1", username: "ana", title: "Cooking live", since: 1, live: true },
    { userId: "u2", username: "ben", title: "Game night", since: 2, live: true },
  ];

  it("matches username or title, case-insensitively", () => {
    expect(filterLiveHosts(hosts, "ANA").map((h) => h.userId)).toEqual(["u1"]);
    expect(filterLiveHosts(hosts, "game").map((h) => h.userId)).toEqual(["u2"]);
  });

  it("returns everyone for an empty term", () => {
    expect(filterLiveHosts(hosts, "  ")).toHaveLength(2);
  });
});
