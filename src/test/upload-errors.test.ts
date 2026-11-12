import { describe, expect, it, vi } from "vitest";

import {
  classifyUploadError,
  describeUploadError,
  errorText,
  isRetryableUploadError,
  withUploadRetry,
} from "@/lib/uploadErrors";

describe("errorText", () => {
  it("reads plain strings", () => {
    expect(errorText("boom")).toBe("boom");
  });

  it("reads Error messages", () => {
    expect(errorText(new Error("nope"))).toBe("nope");
  });

  it("keeps supabase status and code so they can be classified", () => {
    const error = Object.assign(new Error("upload failed"), { statusCode: "413", code: "X" });
    const text = errorText(error);
    expect(text).toContain("413");
    expect(text).toContain("X");
  });

  it("reads plain objects like supabase StorageError", () => {
    expect(errorText({ message: "Bucket not found", status: 404 })).toContain("Bucket not found");
  });

  it("returns empty for junk", () => {
    expect(errorText(undefined)).toBe("");
    expect(errorText(null)).toBe("");
    expect(errorText(42)).toBe("");
  });
});

describe("classifyUploadError", () => {
  it("spots oversized payloads", () => {
    expect(classifyUploadError(new Error("Payload too large"))).toBe("too-large");
    expect(classifyUploadError({ statusCode: "413" })).toBe("too-large");
    expect(classifyUploadError("exceeded the maximum allowed size")).toBe("too-large");
  });

  it("spots expired sessions", () => {
    expect(classifyUploadError(new Error("JWT expired"))).toBe("not-signed-in");
    expect(classifyUploadError({ message: "invalid claim", status: 401 })).toBe("not-signed-in");
  });

  it("spots row-level-security rejections", () => {
    expect(classifyUploadError(new Error("new row violates row-level security policy"))).toBe(
      "forbidden",
    );
  });

  it("spots missing buckets and tables", () => {
    expect(classifyUploadError(new Error("Bucket not found"))).toBe("not-configured");
  });

  it("spots dropped connections", () => {
    expect(classifyUploadError(new TypeError("Failed to fetch"))).toBe("offline");
    expect(classifyUploadError(new Error("The operation timed out"))).toBe("offline");
  });

  it("spots rate limits and server faults", () => {
    expect(classifyUploadError(new Error("429 Too Many Requests"))).toBe("rate-limited");
    expect(classifyUploadError(new Error("503 Service Unavailable"))).toBe("server");
  });

  it("falls back to unknown", () => {
    expect(classifyUploadError(new Error("something odd"))).toBe("unknown");
    expect(classifyUploadError(undefined)).toBe("unknown");
  });
});

describe("describeUploadError", () => {
  it("never returns the old catch-all for a known cause", () => {
    expect(describeUploadError(new Error("Payload too large"))).not.toBe(
      "Upload failed. Try again.",
    );
    expect(describeUploadError(new Error("Payload too large"))).toMatch(/too big/i);
  });

  it("tells the user to sign in again when the session died", () => {
    expect(describeUploadError(new Error("JWT expired"))).toMatch(/sign in again/i);
  });

  it("keeps a friendly generic message when nothing matches", () => {
    expect(describeUploadError(new Error("???"))).toBe("Upload failed. Try again.");
  });
});

describe("withUploadRetry", () => {
  it("returns the first successful result", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    await expect(withUploadRetry(run, 3, async () => {})).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("retries transient network failures", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue("ok");
    await expect(withUploadRetry(run, 3, async () => {})).resolves.toBe("ok");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("does not retry a file that is simply too large", async () => {
    const run = vi.fn().mockRejectedValue(new Error("Payload too large"));
    await expect(withUploadRetry(run, 3, async () => {})).rejects.toThrow("Payload too large");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("gives up after the attempt budget", async () => {
    const run = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(withUploadRetry(run, 3, async () => {})).rejects.toThrow("Failed to fetch");
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("classifies which failures are worth retrying", () => {
    expect(isRetryableUploadError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRetryableUploadError(new Error("503 Service Unavailable"))).toBe(true);
    expect(isRetryableUploadError(new Error("Payload too large"))).toBe(false);
    expect(isRetryableUploadError(new Error("JWT expired"))).toBe(false);
  });
});
