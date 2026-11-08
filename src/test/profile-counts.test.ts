import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Profile numbers must come from `count: "exact", head: true` queries, not the
 * length of a fetched list. Supabase caps list responses at 1000 rows, which is
 * exactly how profiles used to freeze at "1000 videos".
 */

const { state } = vi.hoisted(() => ({
  state: {
    counts: {} as Record<string, number>,
    headFilters: [] as { table: string; column: string; value: unknown }[],
    orFilters: [] as { table: string; filter: string }[],
    rows: [] as Record<string, unknown>[],
    ranges: [] as { from: number; to: number }[],
    paged: false,
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  function builder(table: string) {
    const api: any = {
      select(_cols: string, opts?: { count?: string; head?: boolean }) {
        if (opts?.head) {
          return {
            eq(column: string, value: unknown) {
              state.headFilters.push({ table, column, value });
              return Promise.resolve({ count: state.counts[table] ?? 0, error: null });
            },
            or(filter: string) {
              state.orFilters.push({ table, filter });
              return Promise.resolve({ count: state.counts[table] ?? 0, error: null });
            },
          };
        }
        return api;
      },
      eq() {
        return api;
      },
      or(filter: string) {
        state.orFilters.push({ table, filter });
        return api;
      },
      order() {
        return api;
      },
      range(from: number, to: number) {
        state.ranges.push({ from, to });
        const data = state.paged ? state.rows.slice(from, to + 1) : state.rows;
        return Promise.resolve({ data, error: null });
      },
    };
    return api;
  }
  return { supabase: { from: (table: string) => builder(table) } };
});

import {
  PROFILE_PAGE_SIZE,
  fetchLikesReceived,
  fetchProfileCounts,
  fetchProfileVideosPage,
  formatProfileCount,
} from "@/lib/profile";

beforeEach(() => {
  state.counts = {};
  state.headFilters.length = 0;
  state.orFilters.length = 0;
  state.rows = [];
  state.ranges.length = 0;
  state.paged = false;
});

describe("fetchProfileCounts", () => {
  it("returns exact totals well past the 1000 row response cap", async () => {
    state.counts = {
      videos: 1542,
      likes: 2310,
      reposts: 379,
      saved_videos: 419,
      follows: 12500,
    };

    const counts = await fetchProfileCounts("user-1", "drew");

    expect(counts.videos).toBe(1542);
    expect(counts.likes).toBe(2310);
    expect(counts.reposts).toBe(379);
    expect(counts.saved).toBe(419);
    expect(counts.followers).toBe(12500);
    expect(counts.following).toBe(12500);
  });

  it("counts followers by following_username and following by follower_username", async () => {
    await fetchProfileCounts("user-1", "drew");

    expect(state.headFilters).toContainEqual({
      table: "follows",
      column: "following_username",
      value: "drew",
    });
    expect(state.headFilters).toContainEqual({
      table: "follows",
      column: "follower_username",
      value: "drew",
    });
  });

  it("counts videos by user_id with a legacy username fallback", async () => {
    state.counts = { videos: 1055 };

    const counts = await fetchProfileCounts("user-1", "drew");

    expect(counts.videos).toBe(1055);
    expect(state.orFilters).toContainEqual({
      table: "videos",
      filter: 'user_id.eq.user-1,username.eq."drew"',
    });
  });

  it("counts likes the profile gave, keyed by user_id", async () => {
    state.counts = { likes: 2310 };

    const counts = await fetchProfileCounts("user-1", "drew");

    expect(counts.likes).toBe(2310);
    expect(state.headFilters).toContainEqual({
      table: "likes",
      column: "user_id",
      value: "user-1",
    });
  });

  it("sums likes received across every video page", async () => {
    state.paged = true;
    state.rows = Array.from({ length: 1000 }, () => ({ likes_count: 2 }));

    await expect(fetchLikesReceived("drew")).resolves.toBe(2000);
    expect(state.ranges[0]).toEqual({ from: 0, to: 999 });
    expect(state.ranges[1]).toEqual({ from: 1000, to: 1999 });
  });
});

describe("fetchProfileVideosPage", () => {
  it("pages with range(offset, offset + 29) instead of a hard limit", async () => {
    state.rows = Array.from({ length: PROFILE_PAGE_SIZE }, (_, i) => ({ id: `v${i}` }));

    const page = await fetchProfileVideosPage("drew", 60);

    expect(state.ranges[0]).toEqual({ from: 60, to: 89 });
    expect(page.rows).toHaveLength(PROFILE_PAGE_SIZE);
    expect(page.hasMore).toBe(true);
  });

  it("uses the same owner predicate as the video count", async () => {
    state.rows = [{ id: "v1" }];

    await fetchProfileVideosPage("drew", 0, PROFILE_PAGE_SIZE, "user-1");

    expect(state.orFilters).toContainEqual({
      table: "videos",
      filter: 'user_id.eq.user-1,username.eq."drew"',
    });
  });

  it("reports no more pages on a short page", async () => {
    state.rows = [{ id: "v1" }];

    const page = await fetchProfileVideosPage("drew", 0);

    expect(page.hasMore).toBe(false);
  });
});

describe("formatProfileCount", () => {
  it("shows exact numbers below 1000", () => {
    expect(formatProfileCount(0)).toBe("0");
    expect(formatProfileCount(942)).toBe("942");
  });

  it("compacts thousands and millions like TikTok", () => {
    expect(formatProfileCount(1000)).toBe("1K");
    expect(formatProfileCount(1542)).toBe("1.5K");
    expect(formatProfileCount(12500)).toBe("12.5K");
    expect(formatProfileCount(1_200_000)).toBe("1.2M");
  });
});
