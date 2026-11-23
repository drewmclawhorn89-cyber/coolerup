import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FEED_PAGE_SIZE,
  feedPageSize,
  isLiteMode,
  isLowDataMode,
  setLowDataMode,
} from "@/lib/network";
import { PROFILE_PAGE_SIZE } from "@/lib/profile";
import { SEARCH_PAGE_SIZE } from "@/lib/search";
import { GIF_PAGE_SIZE } from "@/lib/gif";
import { MUSIC_PAGE_SIZE } from "@/lib/sounds";
import { autoRendition, resolveQualitySource, type QualitySources } from "@/lib/videoQuality";
import {
  THUMBNAIL_TTL_MS,
  clearExpiredThumbnails,
  clearThumbnailCache,
  getCachedThumbnailSync,
  setCachedThumbnail,
} from "@/lib/thumbnailCache";
import {
  FeedSkeleton,
  FullVideoGridSkeleton,
  GifGridSkeleton,
  InboxSkeleton,
  SearchSkeleton,
  VideoGridSkeleton,
} from "@/components/Skeletons";

const SAMPLE_VIDEO: QualitySources = {
  video_url: "storage:original.mp4",
  video_1080_url: "storage:1080.mp4",
  video_720_url: "storage:720.mp4",
  video_480_url: "storage:480.mp4",
  video_360_url: "storage:360.mp4",
};

beforeEach(() => {
  localStorage.clear();
  clearThumbnailCache();
});

afterEach(() => {
  cleanup();
});

describe("10-at-a-time pagination defaults", () => {
  it("loads 10 items per page across feed, profile, search, gifs, and music", () => {
    expect(FEED_PAGE_SIZE).toBe(10);
    expect(feedPageSize()).toBe(10);
    expect(PROFILE_PAGE_SIZE).toBe(10);
    expect(SEARCH_PAGE_SIZE).toBe(10);
    expect(GIF_PAGE_SIZE).toBe(10);
    expect(MUSIC_PAGE_SIZE).toBe(10);
  });
});

describe("Low Data Mode", () => {
  it("defaults to off and enables lite mode when turned on", () => {
    expect(isLowDataMode()).toBe(false);
    setLowDataMode(true);
    expect(isLowDataMode()).toBe(true);
    expect(isLiteMode()).toBe(true);
    setLowDataMode(false);
    expect(isLowDataMode()).toBe(false);
  });

  it("forces auto rendition to 360p and badges Low Data when active", () => {
    expect(autoRendition("4g", true)).toBe("360p");
    const resolved = resolveQualitySource(SAMPLE_VIDEO, "auto", "4g", true);
    expect(resolved.url).toBe("storage:360.mp4");
    expect(resolved.rendition).toBe("360p");
    expect(resolved.badge).toBe("Low Data · 360p");
  });
});

describe("1-hour thumbnail cache", () => {
  it("keeps THUMBNAIL_TTL_MS at 1 hour", () => {
    expect(THUMBNAIL_TTL_MS).toBe(3_600_000);
  });

  it("serves cached compressed thumbnails before 1 hour and expires them after 1 hour", () => {
    const start = 1_700_000_000_000;
    setCachedThumbnail(
      "https://cdn.example.com/poster.jpg",
      "data:image/jpeg;base64,thumb",
      "std",
      THUMBNAIL_TTL_MS,
      start,
    );

    expect(
      getCachedThumbnailSync("https://cdn.example.com/poster.jpg", "std", start + 3_599_999),
    ).toBe("data:image/jpeg;base64,thumb");

    expect(
      getCachedThumbnailSync("https://cdn.example.com/poster.jpg", "std", start + 3_600_001),
    ).toBeNull();

    clearExpiredThumbnails(start + 3_600_001);
    expect(
      getCachedThumbnailSync("https://cdn.example.com/poster.jpg", "std", start + 3_600_001),
    ).toBeNull();
  });
});

describe("Gray skeleton loading states", () => {
  it("renders accessible status boxes with pulse animations", () => {
    render(
      <div>
        <FeedSkeleton />
        <VideoGridSkeleton count={3} />
        <FullVideoGridSkeleton count={2} />
        <InboxSkeleton count={2} />
        <SearchSkeleton />
        <GifGridSkeleton count={2} />
      </div>,
    );

    const statuses = screen.getAllByRole("status");
    expect(statuses.length).toBeGreaterThanOrEqual(6);
    expect(document.querySelectorAll(".animate-pulse").length).toBeGreaterThan(5);
  });
});
