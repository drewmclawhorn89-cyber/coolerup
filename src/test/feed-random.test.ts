import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The For You feed must draw from the whole video library and reshuffle on
 * every app open. These tests pin that down so a future refactor can't quietly
 * go back to "newest page only, shuffled in place".
 */

const { VIDEOS } = vi.hoisted(() => {
  const VIDEOS = Array.from({ length: 60 }, (_, i) => ({
    id: `v${String(i).padStart(3, "0")}`,
    username: "creator",
    caption: `video ${i}`,
    video_url: "storage:clip.mp4",
    likes_count: 0,
    comments_count: 0,
    shares_count: 0,
    reposts_count: 0,
    created_at: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
  }));
  return { VIDEOS };
});

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder() {
    let idOnly = false;
    const api = {
      select: (cols: string) => {
        idOnly = cols.trim() === "id";
        return api;
      },
      order: () => api,
      range: (from: number, to: number) => {
        const rows = VIDEOS.slice(from, to + 1).map((v) => (idOnly ? { id: v.id } : v));
        return Promise.resolve({ data: rows, error: null });
      },
      in: (_col: string, ids: string[]) => {
        const rows = ids
          .map((id) => VIDEOS.find((v) => v.id === id))
          .filter((v): v is (typeof VIDEOS)[number] => !!v);
        return Promise.resolve({ data: rows, error: null });
      },
    };
    return api;
  }

  return { supabase: { from: () => makeBuilder() } };
});

import { fetchVideos, resetFeedOrder } from "@/lib/loop";

beforeEach(() => {
  resetFeedOrder();
});

describe("randomised For You feed", () => {
  it("pages through the entire library, not just the newest batch", async () => {
    const seen = new Set<string>();
    for (let page = 0; page < 3; page++) {
      const batch = await fetchVideos(page, 20);
      expect(batch).toHaveLength(20);
      batch.forEach((v) => seen.add(v.id));
    }
    expect(seen.size).toBe(VIDEOS.length);
  });

  it("never repeats a video across pages in one session", async () => {
    const first = await fetchVideos(0, 20);
    const second = await fetchVideos(1, 20);
    const overlap = first.filter((v) => second.some((s) => s.id === v.id));
    expect(overlap).toHaveLength(0);
  });

  it("returns a different mix after the feed order is reset", async () => {
    const a = (await fetchVideos(0, 60)).map((v) => v.id).join(",");

    let differs = false;
    for (let attempt = 0; attempt < 5 && !differs; attempt++) {
      resetFeedOrder();
      const b = (await fetchVideos(0, 60)).map((v) => v.id).join(",");
      differs = a !== b;
    }
    expect(differs).toBe(true);
  });

  it("stops cleanly once the shuffled queue is exhausted", async () => {
    await fetchVideos(0, 50);
    expect(await fetchVideos(1, 50)).toHaveLength(10);
    expect(await fetchVideos(2, 50)).toHaveLength(0);
  });
});
