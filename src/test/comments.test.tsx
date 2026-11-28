import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Comments } from "@/components/Comments";
import { useCommentsSheetOpen } from "@/lib/commentsOverlay";

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
const del = vi.fn();
const inFn = vi.fn();

/** Likes query resolves empty by default so the thread still renders. */
let likeRows: unknown[] = [];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: (...args: unknown[]) => {
        select(...args);
        return {
          eq: (...eqArgs: unknown[]) => {
            eq(...eqArgs);
            return {
              order: (...orderArgs: unknown[]) => order(...orderArgs),
              eq: (...moreEq: unknown[]) => ({
                order: (...orderArgs: unknown[]) => order(...orderArgs),
                ...moreEq,
              }),
            };
          },
          in: (...inArgs: unknown[]) => {
            inFn(...inArgs);
            return Promise.resolve({
              data: table === "comment_likes" ? likeRows : [],
              error: null,
            });
          },
        };
      },
      insert: (...args: unknown[]) => {
        insert(...args);
        return {
          select: () => ({ single: () => single() }),
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
      },
      delete: (...args: unknown[]) => {
        del(...args);
        const chain = {
          eq: () => chain,
          then: (resolve: (v: unknown) => void) => resolve({ error: null }),
        };
        return chain;
      },
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    avatar: null,
    handle: "maya.moves",
    signIn: vi.fn(),
    user: { id: "u1" },
  }),
}));

describe("Comments", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    likeRows = [];
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

  it("shows like counts and toggles a like on", async () => {
    order.mockResolvedValue({ data: rows, error: null });
    likeRows = [{ comment_id: "c1", user_id: "someone-else" }];

    render(<Comments videoId="v1" onClose={() => {}} onAdded={() => {}} />);

    // c1 already has one like from another user.
    const likeButtons = await screen.findAllByRole("button", { name: "Like comment" });
    // c1 sorts first (newest-first order preserved from the query), so its
    // button is the one carrying the existing like.
    const likeButton = likeButtons[0]!;
    expect(likeButton).toHaveTextContent("1");

    fireEvent.click(likeButton);

    await waitFor(() => expect(insert).toHaveBeenCalledWith({ comment_id: "c1", user_id: "u1" }));
    const unlike = await screen.findByRole("button", { name: "Unlike comment" });
    expect(unlike).toHaveTextContent("2");
  });

  it("portals a solid 70dvh full-width sheet, hides main bottom nav, and aligns input row", async () => {
    order.mockResolvedValue({ data: rows, error: null });

    function FlagReader() {
      const sheetOpen = useCommentsSheetOpen();
      return <div data-testid="sheet-open-flag">{String(sheetOpen)}</div>;
    }

    const { rerender } = render(
      <>
        <FlagReader />
        <div data-testid="feed-card" style={{ contain: "layout paint style" }}>
          <Comments videoId="v1" onClose={() => {}} onAdded={() => {}} />
        </div>
      </>,
    );

    expect(screen.getByTestId("sheet-open-flag")).toHaveTextContent("true");

    const dialog = await screen.findByRole("dialog", { name: "Comments" });
    // Portaled directly under document.body, outside `.feed-card` containment.
    expect(dialog.parentElement).toBe(document.body);

    const aside = dialog.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.className).toContain("fixed");
    expect(aside?.className).toContain("bottom-0");
    expect(aside?.className).toContain("left-0");
    expect(aside?.className).toContain("w-screen");
    expect(aside?.className).toContain("h-[70dvh]");
    expect(aside?.className).toContain("bg-background");
    expect(aside?.className).toContain("text-white");

    // Input bar renders [Profile pic] [Add a comment…] [GIF] [Post] in one row.
    const input = screen.getByPlaceholderText("Add a comment…");
    const form = input.closest("form");
    expect(form).not.toBeNull();
    expect(form?.className).toContain("flex");
    expect(form?.className).toContain("items-center");
    // Exact horizontal order: [Profile pic] [Add a comment…] [GIF] [Post].
    expect(form?.children).toHaveLength(4);
    expect(form?.children[0]?.tagName).toBe("DIV");
    expect(form?.children[1]).toBe(input);
    expect(form?.children[2]).toBe(screen.getByRole("button", { name: "GIF" }));
    expect(form?.children[3]).toBe(screen.getByRole("button", { name: "Post" }));

    rerender(<FlagReader />);
    expect(screen.queryByRole("dialog", { name: "Comments" })).not.toBeInTheDocument();
    expect(screen.getByTestId("sheet-open-flag")).toHaveTextContent("false");

    const commentsSource = readFileSync(
      join(__dirname, "..", "components", "Comments.tsx"),
      "utf8",
    );
    expect(commentsSource).toContain('backgroundColor: "var(--background)"');
    expect(commentsSource).toContain("calc(env(safe-area-inset-bottom) + 12px)");

    const indexSource = readFileSync(join(__dirname, "..", "routes", "index.tsx"), "utf8");
    expect(indexSource).toContain("const commentsSheetOpen = useCommentsSheetOpen();");
    expect(indexSource).toContain("{!commentsSheetOpen && (");
  });
});
