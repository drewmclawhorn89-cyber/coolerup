import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression guard for the "Couldn't save: new row violates row-level security
 * policy (USING expression) for table \"saved_full_videos\"" bug.
 *
 * Saving used to go through `.upsert()`, which Postgres compiles to
 * `INSERT ... ON CONFLICT DO UPDATE`. The DO UPDATE half is checked against the
 * UPDATE policy, and saved_full_videos had none — so re-saving a video that was
 * already in the table was refused, even though the row was the user's own.
 *
 * These tests pin the shape of the call: an insert (which only needs the INSERT
 * policy that does exist), and a duplicate treated as success.
 */

const insert = vi.fn();
const upsert = vi.fn();
const del = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
    from: () => ({
      insert,
      upsert,
      delete: () => ({ eq: () => ({ eq: del }) }),
      select: () => ({ eq: async () => ({ data: [], error: null }) }),
    }),
  },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }));

const { setFullVideoSaved } = await import("@/lib/savedFullVideos");

describe("saving a full video", () => {
  beforeEach(() => {
    insert.mockReset();
    upsert.mockReset();
    del.mockReset();
    insert.mockResolvedValue({ error: null });
    del.mockResolvedValue({ error: null });
  });

  it("inserts rather than upserts, so no UPDATE policy is required", async () => {
    const result = await setFullVideoSaved("video-1", true);

    expect(result).toEqual({ ok: true, persisted: true });
    expect(insert).toHaveBeenCalledWith({ user_id: "user-1", video_id: "video-1" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("treats a duplicate key as already saved", async () => {
    insert.mockResolvedValue({ error: { code: "23505", message: "duplicate key value" } });

    const result = await setFullVideoSaved("video-1", true);

    expect(result).toEqual({ ok: true, persisted: true });
  });

  it("deletes when unsaving", async () => {
    const result = await setFullVideoSaved("video-1", false);

    expect(result).toEqual({ ok: true, persisted: true });
    expect(del).toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("reports a genuine policy refusal instead of pretending it saved", async () => {
    insert.mockResolvedValue({
      error: {
        code: "42501",
        message: 'new row violates row-level security policy for table "saved_full_videos"',
      },
    });

    const result = await setFullVideoSaved("video-1", true);

    expect(result.ok).toBe(false);
  });
});
