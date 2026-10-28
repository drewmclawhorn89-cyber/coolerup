import { describe, expect, it, vi, beforeEach } from "vitest";

const createSignedUrl = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ createSignedUrl }),
    },
  },
}));

import { resolveMediaUrl, storagePathOf } from "@/lib/media";

describe("storagePathOf", () => {
  it("unwraps storage: references", () => {
    expect(storagePathOf("storage:user/groups/post-1.mp4")).toBe("user/groups/post-1.mp4");
  });

  it("recovers the path from a legacy public URL", () => {
    const url =
      "https://example.supabase.co/storage/v1/object/public/videos/user/groups/post-1.mp4?token=abc";
    expect(storagePathOf(url)).toBe("user/groups/post-1.mp4");
  });

  it("decodes percent-escaped paths", () => {
    const url = "https://example.supabase.co/storage/v1/object/public/videos/a%20b.mp4";
    expect(storagePathOf(url)).toBe("a b.mp4");
  });

  it("leaves external URLs alone", () => {
    expect(storagePathOf("https://cdn.example.com/clip.mp4")).toBeNull();
    expect(storagePathOf("data:image/svg+xml;utf8,<svg/>")).toBeNull();
    expect(storagePathOf(null)).toBeNull();
    expect(storagePathOf("")).toBeNull();
  });
});

describe("resolveMediaUrl", () => {
  beforeEach(() => {
    createSignedUrl.mockReset();
  });

  it("signs a storage: reference", async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed/clip.mp4" }, error: null });
    await expect(resolveMediaUrl("storage:user/clip.mp4")).resolves.toBe("https://signed/clip.mp4");
    expect(createSignedUrl).toHaveBeenCalledWith("user/clip.mp4", expect.any(Number));
  });

  it("signs legacy public URLs instead of returning a 404 link", async () => {
    createSignedUrl.mockResolvedValue({ data: { signedUrl: "https://signed/old.mp4" }, error: null });
    const legacy = "https://x.supabase.co/storage/v1/object/public/videos/user/old.mp4";
    await expect(resolveMediaUrl(legacy)).resolves.toBe("https://signed/old.mp4");
  });

  it("passes through plain URLs without signing", async () => {
    await expect(resolveMediaUrl("https://cdn.example.com/a.mp4")).resolves.toBe(
      "https://cdn.example.com/a.mp4",
    );
    expect(createSignedUrl).not.toHaveBeenCalled();
  });

  it("returns an empty string when signing fails", async () => {
    createSignedUrl.mockResolvedValue({ data: null, error: new Error("nope") });
    await expect(resolveMediaUrl("storage:user/missing.mp4")).resolves.toBe("");
  });

  it("returns an empty string for missing values", async () => {
    await expect(resolveMediaUrl(null)).resolves.toBe("");
    await expect(resolveMediaUrl(undefined)).resolves.toBe("");
  });
});
