import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The profile "Liked" tab reads `likes` joined to `videos`. These tests pin the
 * query shape (newest like first, unambiguous embed) and the cleanup of rows
 * whose video has since been deleted.
 */

const { state } = vi.hoisted(() => ({
  state: {
    rows: [] as { created_at: string; videos: Record<string, unknown> | null }[],
    count: 0,
    selects: [] as string[],
    orders: [] as { column: string; ascending: boolean | undefined }[],
    filters: [] as { column: string; value: unknown }[],
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  function builder() {
    const api = {
      select(cols: string, opts?: { count?: string; head?: boolean }) {
        state.selects.push(cols);
        if (opts?.head) {
          return {
            eq(column: string, value: unknown) {
              state.filters.push({ column, value });
              return Promise.resolve({ count: state.count, error: null });
            },
          };
        }
        return api;
      },
      eq(column: string, value: unknown) {
        state.filters.push({ column, value });
        return api;
      },
      order(column: string, opts?: { ascending?: boolean }) {
        state.orders.push({ column, ascending: opts?.ascending });
        return api;
      },
      limit() {
        return Promise.resolve({ data: state.rows, error: null });
      },
    };
    return api;
  }
  return { supabase: { from: () => builder() } };
});

import { fetchLikedCount, fetchLikedVideos } from "@/lib/loop";

beforeEach(() => {
  state.rows = [];
  state.count = 0;
  state.selects.length = 0;
  state.orders.length = 0;
  state.filters.length = 0;
});

describe("fetchLikedVideos", () => {
  it("reads the profile's likes joined to their videos, newest like first", async () => {
    state.rows = [
      {
        created_at: "2024-02-02",
        videos: { id: "v2", username: "a", caption: "", video_url: "u" },
      },
      {
        created_at: "2024-02-01",
        videos: { id: "v1", username: "b", caption: "", video_url: "u" },
      },
    ];

    const rows = await fetchLikedVideos("user-1");

    expect(state.selects[0]).toContain("videos(*)");
    expect(state.filters).toContainEqual({ column: "user_id", value: "user-1" });
    expect(state.orders[0]).toEqual({ column: "created_at", ascending: false });
    expect(rows.map((v) => v.id)).toEqual(["v2", "v1"]);
  });

  it("skips likes whose video was deleted", async () => {
    state.rows = [
      { created_at: "2024-02-02", videos: null },
      {
        created_at: "2024-02-01",
        videos: { id: "v1", username: "b", caption: "", video_url: "u" },
      },
    ];

    const rows = await fetchLikedVideos("user-1");

    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe("v1");
  });

  it("defaults the repost count so cards render consistently", async () => {
    state.rows = [
      {
        created_at: "2024-02-01",
        videos: { id: "v1", username: "b", caption: "", video_url: "u" },
      },
    ];

    const [video] = await fetchLikedVideos("user-1");

    expect(video?.reposts).toBe(0);
  });
});

describe("fetchLikedCount", () => {
  it("counts likes for the tab label without fetching rows", async () => {
    state.count = 12;

    await expect(fetchLikedCount("user-1")).resolves.toBe(12);
    expect(state.filters).toContainEqual({ column: "user_id", value: "user-1" });
  });
});
