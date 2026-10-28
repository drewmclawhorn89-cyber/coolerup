import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  likeRows: [] as { post_id: string; user_id: string }[],
  calls: [] as string[],
  failOn: null as null | "insert" | "delete" | "select",
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const ctx: { op?: string; filters: Record<string, string> } = { filters: {} };
    const api: any = {
      select: (_cols?: string, opts?: any) => {
        ctx.op = "select";
        state.calls.push(`${table}:select`);
        if (opts?.head) {
          return {
            eq: (col: string, val: string) => {
              if (state.failOn === "select") return Promise.resolve({ count: null, error: new Error("boom") });
              const count = state.likeRows.filter((r) => (r as any)[col] === val).length;
              return Promise.resolve({ count, error: null });
            },
          };
        }
        return {
          in: (_col: string, ids: string[]) =>
            Promise.resolve({
              data: state.likeRows.filter((r) => ids.includes(r.post_id)),
              error: null,
            }),
        };
      },
      upsert: (row: { post_id: string; user_id: string }) => {
        state.calls.push(`${table}:upsert`);
        if (state.failOn === "insert") return Promise.resolve({ error: new Error("insert denied") });
        const exists = state.likeRows.some(
          (r) => r.post_id === row.post_id && r.user_id === row.user_id,
        );
        if (!exists) state.likeRows.push(row);
        return Promise.resolve({ error: null });
      },
      delete: () => ({
        eq: (col: string, val: string) => ({
          eq: (col2: string, val2: string) => {
            state.calls.push(`${table}:delete`);
            if (state.failOn === "delete") return Promise.resolve({ error: new Error("delete denied") });
            state.likeRows = state.likeRows.filter(
              (r) => !((r as any)[col] === val && (r as any)[col2] === val2),
            );
            return Promise.resolve({ error: null });
          },
        }),
      }),
    };
    return api;
  };

  return {
    supabase: {
      from: (table: string) => builder(table),
      auth: {
        getUser: async () => ({ data: { user: state.user } }),
      },
    },
  };
});

import { fetchGroupPostLikes, likeGroupPost } from "@/lib/groups";

const post = (id: string) => ({ id, group_id: "g1", user_id: "u", username: "u", caption: null, video_url: null, image_url: null, created_at: "", likes: 0 });

describe("likeGroupPost", () => {
  beforeEach(() => {
    state.user = { id: "user-1" };
    state.likeRows = [];
    state.calls = [];
    state.failOn = null;
  });

  it("writes a row to group_post_likes instead of bumping a counter", async () => {
    await likeGroupPost(post("p1"), true);
    expect(state.calls).toContain("group_post_likes:upsert");
    expect(state.calls).not.toContain("group_posts:update");
    expect(state.likeRows).toEqual([{ post_id: "p1", user_id: "user-1" }]);
  });

  it("returns the authoritative count", async () => {
    state.likeRows = [
      { post_id: "p1", user_id: "other" },
      { post_id: "p1", user_id: "user-1" },
    ];
    await expect(likeGroupPost(post("p1"), true)).resolves.toBe(2);
  });

  it("is idempotent — liking twice does not double count", async () => {
    await likeGroupPost(post("p1"), true);
    await likeGroupPost(post("p1"), true);
    expect(state.likeRows).toHaveLength(1);
  });

  it("removes the row when unliking", async () => {
    state.likeRows = [{ post_id: "p1", user_id: "user-1" }];
    await expect(likeGroupPost(post("p1"), false)).resolves.toBe(0);
    expect(state.likeRows).toHaveLength(0);
  });

  it("refuses to like while signed out", async () => {
    state.user = null;
    await expect(likeGroupPost(post("p1"), true)).rejects.toThrow(/sign in/i);
  });

  it("surfaces a failed write instead of pretending it saved", async () => {
    state.failOn = "insert";
    await expect(likeGroupPost(post("p1"), true)).rejects.toThrow(/denied/);
  });
});

describe("fetchGroupPostLikes", () => {
  beforeEach(() => {
    state.user = { id: "user-1" };
    state.likeRows = [
      { post_id: "p1", user_id: "user-1" },
      { post_id: "p1", user_id: "other" },
      { post_id: "p2", user_id: "other" },
    ];
    state.calls = [];
    state.failOn = null;
  });

  it("counts likes per post and reports which ones are mine", async () => {
    const { counts, mine } = await fetchGroupPostLikes(["p1", "p2", "p3"]);
    expect(counts).toEqual({ p1: 2, p2: 1 });
    expect([...mine]).toEqual(["p1"]);
  });

  it("skips the query when there are no posts", async () => {
    const { counts, mine } = await fetchGroupPostLikes([]);
    expect(counts).toEqual({});
    expect(mine.size).toBe(0);
    expect(state.calls).toHaveLength(0);
  });

  it("reports nothing as mine when signed out", async () => {
    state.user = null;
    const { mine } = await fetchGroupPostLikes(["p1"]);
    expect(mine.size).toBe(0);
  });
});
