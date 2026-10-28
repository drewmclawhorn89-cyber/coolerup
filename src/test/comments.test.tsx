import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Comments } from "@/components/Comments";

/**
 * Regression tests for the comment panel.
 *
 * The important one is the load-error case: a failed query used to be rendered
 * as "No comments yet", which made a broken backend look like an empty thread.
 * (The insert itself was broken server-side by an ambiguous `handle` reference
 * in a trigger — see drizzle/migrations/0019_fix_comment_insert.sql.)
 */

const rows = [
  {
    id: "c1",
    username: "maya.moves",
    body: "first",
    created_at: "2026-01-01T00:00:00Z",
    gif_url: null,
    parent_id: null,
  },
  {
    id: "r1",
    username: "jordan.out",
    body: "a reply",
    created_at: "2026-01-01T00:01:00Z",
    gif_url: null,
    parent_id: "c1",
  },
];

const order = vi.fn();
const eq = vi.fn();
const select = vi.fn();
const single = vi.fn();
const insert = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: (...args: unknown[]) => {
        select(...args);
        return {
          eq: (...eqArgs: unknown[]) => {
            eq(...eqArgs);
            return { order: (...orderArgs: unknown[]) => order(...orderArgs) };
          },
        };
      },
      insert: (...args: unknown[]) => {
        insert(...args);
        return {
          select: () => ({ single: () => single() }),
        };
      },
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ handle: "maya.moves", signIn: vi.fn() }),
}));

describe("Comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders top-level comments and nests their replies", async () => {
    order.mockResolvedValue({ data: rows, error: null });

    render(<Comments videoId="v1" onClose={() => {}} onAdded={() => {}} />);

    expect(await screen.findByText("first")).toBeInTheDocument();
    expect(screen.getByText("a reply")).toBeInTheDocument();
    expect(screen.getByText("Comments (2)")).toBeInTheDocument();
    expect(eq).toHaveBeenCalledWith("video_id", "v1");
  });

  it("shows the real error instead of 'No comments yet' when the query fails", async () => {
    order.mockResolvedValue({
      data: null,
      error: { message: 'column reference "handle" is ambiguous' },
    });

    render(<Comments videoId="v1" onClose={() => {}} onAdded={() => {}} />);

    expect(
      await screen.findByText(/Couldn't load comments: column reference "handle" is ambiguous/),
    ).toBeInTheDocument();
    expect(screen.queryByText("No comments yet. Be the first.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("posts a comment and adds it to the thread", async () => {
    order.mockResolvedValue({ data: [], error: null });
    single.mockResolvedValue({
      data: {
        id: "c2",
        username: "maya.moves",
        body: "hello",
        created_at: "2026-01-01T00:02:00Z",
        gif_url: null,
        parent_id: null,
      },
      error: null,
    });
    const onAdded = vi.fn();

    render(<Comments videoId="v1" onClose={() => {}} onAdded={onAdded} />);

    fireEvent.change(await screen.findByPlaceholderText("Add a comment…"), {
      target: { value: "hello" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(onAdded).toHaveBeenCalledTimes(1));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ video_id: "v1", username: "maya.moves", body: "hello" }),
    );
    expect(await screen.findByText("hello")).toBeInTheDocument();
  });
});
