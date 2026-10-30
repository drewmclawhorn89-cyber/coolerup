import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Record with a sound" bakes the chosen sound into the recorded file and marks
 * the caption with [[baked]]. These tests pin down the marker parsing and the
 * upload payload so the feed never overlays the same song twice.
 */

const { inserts, uploads } = vi.hoisted(() => ({
  inserts: [] as Record<string, unknown>[],
  uploads: [] as { path: string; contentType?: string | undefined }[],
}));

vi.mock("@/integrations/supabase/client", () => {
  return {
    supabase: {
      storage: {
        from: () => ({
          upload: async (path: string, _blob: Blob, opts?: { contentType?: string }) => {
            uploads.push({ path, contentType: opts?.contentType });
            return { error: null };
          },
          createSignedUrl: async () => ({ data: { signedUrl: "https://cdn.test/clip.webm" } }),
        }),
      },
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: "video-1" }, error: null }),
            }),
          };
        },
      }),
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

import { parseCaption, uploadRecording } from "@/lib/loop";
import { soundTitleForVideo } from "@/lib/sounds";

beforeEach(() => {
  inserts.length = 0;
  uploads.length = 0;
});

describe("baked sound marker", () => {
  it("strips [[baked]] from the visible caption", () => {
    const parsed = parseCaption("first take [[baked]]");
    expect(parsed.text).toBe("first take");
    expect(parsed.baked).toBe(true);
  });

  it("handles [[song:...]] and [[baked]] together", () => {
    const parsed = parseCaption("clip [[song:42|Night Drive|Nova]][[baked]]");
    expect(parsed.text).toBe("clip");
    expect(parsed.baked).toBe(true);
    expect(parsed.song).toEqual({ id: "42", title: "Night Drive", artist: "Nova" });
  });

  it("leaves normal captions alone", () => {
    const parsed = parseCaption("just a caption");
    expect(parsed.text).toBe("just a caption");
    expect(parsed.baked).toBe(false);
  });

  it("keeps the marker out of sound titles", () => {
    expect(soundTitleForVideo("my clip [[baked]]", "drew")).toBe("my clip");
    expect(soundTitleForVideo("[[baked]]", "drew")).toBe("Original sound - @drew");
  });
});

describe("uploadRecording", () => {
  it("marks the caption and attaches the sound when the song was baked in", async () => {
    const blob = new Blob(["video"], { type: "video/webm" });
    const id = await uploadRecording(blob, "drew", "beach day", "sound-9", true);

    expect(id).toBe("video-1");
    expect(uploads).toHaveLength(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      username: "drew",
      caption: "beach day[[baked]]",
      sound_id: "sound-9",
    });
  });

  it("does not mark the caption when the sound is only metadata", async () => {
    const blob = new Blob(["video"], { type: "video/webm" });
    await uploadRecording(blob, "drew", "beach day", "sound-9", false);

    expect(inserts[0]).toMatchObject({ caption: "beach day", sound_id: "sound-9" });
  });
});
