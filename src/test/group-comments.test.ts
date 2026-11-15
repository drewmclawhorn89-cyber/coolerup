import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  comments: [] as Array<{
    id: string;
    post_id: string;
    user_id: string;
    username: string;
    body: string;
    gif_url: string | null;
    gif_credit: string | null;
    created_at: string;
  }>,
  failError: null as Error | null,
}));

vi.mock("@/integrations/supabase/client", () => {
  const builder = (table: string) => {
    const api: Record<string, unknown> = {
      select: () => ({
        in: (_col: string, ids: string[]) => {
          if (state.failError) return Promise.resolve({ data: null, error: state.failError });
          return Promise.resolve({
            data:
              table === "group_post_comments"
                ? state.comments.filter((c) => ids.includes(c.post_id))
                : [],
            error: null,
          });
        },
        eq: (_col: string, val: string) => ({
          order: () => ({
            limit: () => {
              if (state.failError) return Promise.resolve({ data: null, error: state.failError });
              return Promise.resolve({
                data: state.comments.filter((c) => c.post_id === val),
                error: null,
              });
            },
          }),
        }),
      }),
      insert: (row: {
        post_id: string;
        user_id: string;
        username: string;
        body: string;
        gif_url: string | null;
        gif_credit: string | null;
      }) => ({
        select: () => ({
          single: () => {
            if (state.failError) return Promise.resolve({ data: null, error: state.failError });
            const created = {
              id: `c-${state.comments.length + 1}`,
              ...row,
              created_at: "2026-11-14T18:00:00Z",
            };
            state.comments.push(created);
            return Promise.resolve({ data: created, error: null });
          },
        }),
      }),
      delete: () => ({
        eq: (_col: string, val: string) => {
          if (state.failError) return Promise.resolve({ error: state.failError });
          state.comments = state.comments.filter((c) => c.id !== val);
          return Promise.resolve({ error: null });
        },
      }),
    };
    return api;
  };

  return {
    supabase: {
      from: (table: string) => builder(table),
      auth: {
        getUser: async () => ({ data: { user: { id: "u1" } } }),
      },
    },
  };
});

import {
  createGroupPostComment,
  deleteGroupPostComment,
  fetchGroupPostCommentCounts,
  fetchGroupPostComments,
} from "@/lib/groups";

describe("group post comments", () => {
  beforeEach(() => {
    state.comments = [];
    state.failError = null;
  });

  it("creates, fetches, counts, and deletes comments on a group post", async () => {
    const c1 = await createGroupPostComment({
      postId: "p1",
      userId: "u1",
      username: "drew",
      body: "  Awesome clip!  ",
    });

    expect(c1.body).toBe("Awesome clip!");
    expect(c1.username).toBe("drew");

    const rows = await fetchGroupPostComments("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toBe("Awesome clip!");

    const counts = await fetchGroupPostCommentCounts(["p1", "p2"]);
    expect(counts).toEqual({ p1: 1 });

    await deleteGroupPostComment(c1.id);
    expect(await fetchGroupPostComments("p1")).toHaveLength(0);
  });

  it("rejects empty comments without a GIF", async () => {
    await expect(
      createGroupPostComment({
        postId: "p1",
        userId: "u1",
        username: "drew",
        body: "   ",
      }),
    ).rejects.toThrow(/write a comment/i);
  });
});
