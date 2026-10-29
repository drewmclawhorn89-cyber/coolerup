import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `sounds` has two foreign keys to `videos` (videos.sound_id and
 * sounds.original_video_id). A bare `sounds(...)` embed is therefore ambiguous
 * and PostgREST rejects the whole query with PGRST201, which blanked the feed
 * with "Couldn't load videos". These tests pin down both the disambiguated
 * embed and the fallback that keeps the feed alive if the embed ever breaks.
 */

const { VIDEOS, selects, failEmbeds } = vi.hoisted(() => {
  const VIDEOS = Array.from({ length: 5 }, (_, i) => ({
    id: `v${i}`,
    username: "creator",
    caption: `video ${i}`,
    video_url: "storage:clip.mp4",
    likes_count: 1,
    comments_count: 0,
    shares_count: 0,
    reposts_count: 0,
    created_at: new Date(Date.UTC(2024, 0, 1, 0, i)).toISOString(),
    sound_id: null,
  }));
  return { VIDEOS, selects: [] as string[], failEmbeds: { value: false } };
});

vi.mock("@/integrations/supabase/client", () => {
  function makeBuilder() {
    let cols = "";
    const api = {
      select: (c: string) => {
        cols = c;
        selects.push(c);
        return api;
      },
      order: () => api,
      range: (from: number, to: number) =>
        Promise.resolve({ data: VIDEOS.slice(from, to + 1).map((v) => ({ id: v.id })), error: null }),
      in: (_col: string, ids: string[]) => {
        if (failEmbeds.value && cols.includes("sounds")) {
          return Promise.resolve({
            data: null,
            error: {
              code: "PGRST201",
              message: "Could not embed because more than one relationship was found",
            },
          });
        }
        const rows = ids.map((id) => VIDEOS.find((v) => v.id === id)).filter(Boolean);
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
  selects.length = 0;
  failEmbeds.value = false;
});

describe("feed sound embed", () => {
  it("names the videos_sound_id_fkey relationship so the embed is unambiguous", async () => {
    await fetchVideos(0, 5);
    const embed = selects.find((s) => s.includes("sounds"));
    expect(embed).toBeDefined();
    expect(embed).toContain("sounds!videos_sound_id_fkey(");
    expect(embed).not.toMatch(/[^!]sounds\(/);
  });

  it("still returns videos when the sound embed is rejected", async () => {
    failEmbeds.value = true;
    const batch = await fetchVideos(0, 5);
    expect(batch).toHaveLength(5);
    expect(new Set(batch.map((v) => v.id))).toEqual(new Set(VIDEOS.map((v) => v.id)));
    // The retry must ask for plain columns, not the broken embed.
    expect(selects.at(-1)).not.toContain("sounds");
  });
});
