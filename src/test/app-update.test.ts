import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appBuildId, isStaleBuild, watchForUpdate } from "@/lib/appBuild";
import { LIVE, normalizeStatus, watchAppStatus, type AppStatus } from "@/lib/maintenance";

describe("build identity", () => {
  it("falls back to dev when the build id was never injected", () => {
    expect(appBuildId()).toBe("dev");
  });

  it("treats a different server build as stale", () => {
    expect(isStaleBuild("abc123", "def456")).toBe(true);
  });

  it("treats the same build as up to date", () => {
    expect(isStaleBuild("abc123", "abc123")).toBe(false);
  });

  it("never reports stale when either side is dev", () => {
    expect(isStaleBuild("dev", "abc123")).toBe(false);
    expect(isStaleBuild("abc123", "dev")).toBe(false);
  });

  it("never reports stale on a missing build id", () => {
    expect(isStaleBuild("", "abc123")).toBe(false);
    expect(isStaleBuild("abc123", null)).toBe(false);
    expect(isStaleBuild("abc123", undefined)).toBe(false);
  });
});

describe("watchForUpdate", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("fires once when the server reports a newer build", async () => {
    const onStale = vi.fn();
    const stop = watchForUpdate({
      clientBuild: "old",
      probe: async () => "new",
      onStale,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onStale).toHaveBeenCalledTimes(1);
    expect(onStale).toHaveBeenCalledWith("new");

    // Keeps polling, but must not fire again.
    await vi.advanceTimersByTimeAsync(180_000);
    expect(onStale).toHaveBeenCalledTimes(1);
    stop();
  });

  it("stays quiet when the client is current", async () => {
    const onStale = vi.fn();
    const stop = watchForUpdate({ clientBuild: "same", probe: async () => "same", onStale });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(onStale).not.toHaveBeenCalled();
    stop();
  });

  it("does not shut the app down when the probe throws", async () => {
    const onStale = vi.fn();
    const stop = watchForUpdate({
      clientBuild: "old",
      probe: async () => {
        throw new Error("offline");
      },
      onStale,
    });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(onStale).not.toHaveBeenCalled();
    stop();
  });

  it("stops polling after cleanup", async () => {
    const probe = vi.fn(async () => "new");
    const stop = watchForUpdate({ clientBuild: "old", probe, onStale: () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    const calls = probe.mock.calls.length;
    stop();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(probe.mock.calls.length).toBe(calls);
  });
});

describe("maintenance status", () => {
  it("reads the flag from a single-row RPC response", () => {
    const status = normalizeStatus([
      { is_maintenance: true, maintenance_message: "Back in 5", updated_at: "2024-01-01T00:00:00Z" },
    ]);
    expect(status.maintenance).toBe(true);
    expect(status.message).toBe("Back in 5");
  });

  it("treats a missing row as live", () => {
    expect(normalizeStatus(null)).toEqual(LIVE);
    expect(normalizeStatus([])).toEqual(LIVE);
  });

  it("treats a null flag as live", () => {
    expect(normalizeStatus([{ is_maintenance: null }]).maintenance).toBe(false);
  });

  it("drops blank messages so the default copy is used", () => {
    expect(normalizeStatus([{ is_maintenance: true, maintenance_message: "   " }]).message).toBe(
      null,
    );
  });

  it("reports changes and ignores an unreachable backend", async () => {
    vi.useFakeTimers();
    const seen: AppStatus[] = [];
    const responses: (AppStatus | null)[] = [
      { maintenance: false, message: null, updatedAt: null },
      null,
      { maintenance: true, message: "Updating", updatedAt: null },
      { maintenance: true, message: "Updating", updatedAt: null },
      { maintenance: false, message: null, updatedAt: null },
    ];
    let i = 0;

    const stop = watchAppStatus({
      intervalMs: 1000,
      probe: async () => responses[Math.min(i++, responses.length - 1)] ?? null,
      onChange: (s) => seen.push(s),
    });

    for (let n = 0; n < 5; n++) await vi.advanceTimersByTimeAsync(1000);
    stop();
    vi.useRealTimers();

    // live -> (null ignored) -> maintenance -> (duplicate ignored) -> live
    expect(seen.map((s) => s.maintenance)).toEqual([false, true, false]);
  });
});
