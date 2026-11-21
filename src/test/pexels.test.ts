import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimiter,
  __setRateLimitForTest,
  backoffDelay,
  creditLine,
  fetchPopular,
  pickBestMp4,
  searchVideos,
  type PexelsVideo,
} from "@/lib/pexels.server";
import { captionFor, storagePathFor } from "@/lib/pexelsSync.server";

function video(overrides: Partial<PexelsVideo> = {}): PexelsVideo {
  return {
    id: 123,
    width: 1080,
    height: 1920,
    url: "https://www.pexels.com/video/123/",
    image: "https://images.pexels.com/123.jpg",
    duration: 12,
    user: { id: 7, name: "Ada Film", url: "https://www.pexels.com/@ada" },
    video_files: [
      { id: 1, quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://cdn/360.mp4" },
      { id: 2, quality: "hd", file_type: "video/mp4", width: 1080, height: 1920, link: "https://cdn/1080.mp4" },
      { id: 3, quality: "hls", file_type: "application/x-mpegURL", width: 1080, height: 1920, link: "https://cdn/playlist.m3u8" },
    ],
    ...overrides,
  };
}

describe("pickBestMp4", () => {
  it("prefers a vertical MP4 and never returns HLS", () => {
    expect(pickBestMp4(video())?.link).toBe("https://cdn/1080.mp4");
  });

  it("falls back to landscape when there is no vertical rendition", () => {
    const landscape = video({
      video_files: [
        { id: 1, quality: "sd", file_type: "video/mp4", width: 640, height: 360, link: "https://cdn/360.mp4" },
        { id: 2, quality: "hd", file_type: "video/mp4", width: 1920, height: 1080, link: "https://cdn/1080.mp4" },
      ],
    });
    expect(pickBestMp4(landscape)?.link).toBe("https://cdn/1080.mp4");
  });

  it("returns null when there is no MP4 at all", () => {
    const hlsOnly = video({
      video_files: [
        { id: 3, quality: "hls", file_type: "application/x-mpegURL", width: 1080, height: 1920, link: "https://cdn/playlist.m3u8" },
      ],
    });
    expect(pickBestMp4(hlsOnly)).toBeNull();
  });
});

describe("provenance helpers", () => {
  it("credits the real filmmaker", () => {
    expect(creditLine(video())).toBe("Video by Ada Film on Pexels");
  });

  it("handles a missing author name", () => {
    expect(creditLine(video({ user: { id: 0, name: "  ", url: "" } }))).toBe(
      "Video by a Pexels creator on Pexels",
    );
  });

  it("puts the credit and duration in the caption, capped at 300 chars", () => {
    const caption = captionFor(video());
    expect(caption).toBe("Video by Ada Film on Pexels · 12s");
    expect(caption.length).toBeLessThanOrEqual(300);
  });

  it("derives a deterministic storage path from the id", () => {
    expect(storagePathFor(123)).toBe("pexels/123.mp4");
    expect(storagePathFor(123)).toBe(storagePathFor("123"));
  });
});

describe("backoffDelay", () => {
  it("stays within the exponential ceiling", () => {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const delay = backoffDelay(attempt, 500, 20_000);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(Math.min(20_000, 500 * 2 ** attempt));
    }
  });
});

describe("Pexels client retries", () => {
  const realFetch = globalThis.fetch;

  beforeEach(() => {
    __setRateLimitForTest(1000);
    process.env["PEXELS_API_KEY"] = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    __resetRateLimiter();
    vi.restoreAllMocks();
  });

  it("retries a 500 and then succeeds", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response("boom", { status: 500 });
      return Response.json({ page: 1, per_page: 1, total_results: 1, videos: [video()] });
    }) as unknown as typeof fetch;

    const page = await fetchPopular(1, 1, { attempts: 3 });
    expect(calls).toBe(2);
    expect(page.videos).toHaveLength(1);
  });

  it("honours Retry-After on a 429", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response("slow down", { status: 429, headers: { "retry-after": "0" } });
      }
      return Response.json({ page: 1, per_page: 1, total_results: 0, videos: [] });
    }) as unknown as typeof fetch;

    await searchVideos("cats", 1, 1, { attempts: 2 });
    expect(calls).toBe(2);
  });

  it("does not retry a rejected key", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls += 1;
      return new Response("nope", { status: 401 });
    }) as unknown as typeof fetch;

    await expect(fetchPopular(1, 1, { attempts: 4 })).rejects.toMatchObject({
      reason: "unauthorized",
    });
    expect(calls).toBe(1);
  });

  it("fails clearly when the key is missing", async () => {
    delete process.env["PEXELS_API_KEY"];
    await expect(fetchPopular(1, 1)).rejects.toMatchObject({ reason: "no_api_key" });
  });
});
