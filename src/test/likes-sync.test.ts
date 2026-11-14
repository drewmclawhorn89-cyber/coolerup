import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `fetchMyLikes()` powers every filled heart in the app. Supabase caps a single
 * response at ~1000 rows, so it must page through the user's likes instead of
 * trusting one select — otherwise a heavy liker's older likes never load, the
 * hearts look empty, and tapping one used to fail with a duplicate-key error.
 */

const { state } = vi.hoisted(() => ({
  state: {
    user: { id: "user-1" } as { id: string } | null,
    all: [] as { video_id: string }[],
    ranges: [] as { from: number; to: number }[],
  },
}));

vi.mock("@/integrations/supabase/client", () => {
  function builder() {
    const api = {
      select() {
        return api;
      },
      eq() {
        return api;
      },
      order() {
        return api;
      },
      range(from: number, to: number) {
        state.ranges.push({ from, to });
        return Promise.resolve({
          data: state.all.slice(from, to + 1),
          error: null,
        });
      },
    };
    return api;
  }
  return {
    supabase: {
      auth: { getUser: async () => ({ data: { user: state.user } }) },
      from: () => builder(),
    },
  };
});

import { fetchMyLikes } from "@/lib/loop";

beforeEach(() => {
  state.user = { id: "user-1" };
  state.all = [];
  state.ranges.length = 0;
});

describe("fetchMyLikes", () => {
  it("returns an empty set when nobody is signed in", async () => {
    state.user = null;
    state.all = [{ video_id: "v1" }];

    const ids = await fetchMyLikes();

    expect(ids.size).toBe(0);
    expect(state.ranges).toHaveLength(0);
  });

  it("pages past the 1000-row response cap so no like is dropped", async () => {
    state.all = Array.from({ length: 1500 }, (_, i) => ({ video_id: `v${i}` }));

    const ids = await fetchMyLikes();

    expect(ids.size).toBe(1500);
    expect(ids.has("v0")).toBe(true);
    expect(ids.has("v1499")).toBe(true);
    // 1000 on the first page, 500 on the second, then a short page stops it.
    expect(state.ranges).toEqual([
      { from: 0, to: 999 },
      { from: 1000, to: 1999 },
    ]);
  });

  it("stops after a single short page", async () => {
    state.all = [{ video_id: "v1" }, { video_id: "v2" }];

    const ids = await fetchMyLikes();

    expect([...ids].sort()).toEqual(["v1", "v2"]);
    expect(state.ranges).toEqual([{ from: 0, to: 999 }]);
  });
});
