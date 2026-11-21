import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  clearWatchHistory,
  createWatchDurationTracker,
  detectExternalVideoSource,
  encodeWatchHistoryId,
  formatWatchedWhen,
  listWatchHistory,
  recordWatchHistory,
  removeWatchHistoryItem,
  WATCH_HISTORY_RED,
  writeSaveWatchHistory,
} from "@/lib/watchHistory";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children, to, ...props }: { children: React.ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "user-alpha" },
    ready: true,
    name: "Alpha",
    handle: "alpha",
    avatar: null,
    profile: null,
    isAdmin: false,
    onboarding: {
      ready: true,
      complete: true,
      needsOnboarding: false,
      isNewUser: false,
      username: "alpha",
      birthday: "2000-01-01",
    },
    signIn: vi.fn(),
    signOut: vi.fn(),
  }),
}));

import { WatchHistoryPage } from "@/routes/watch-history";

describe("watchHistory library & rules", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers watch history recording only after > 3 seconds of active playback", () => {
    vi.useFakeTimers();
    const onTrigger = vi.fn();
    const tracker = createWatchDurationTracker({ onTrigger });

    tracker.start();
    vi.advanceTimersByTime(2900);
    expect(onTrigger).not.toHaveBeenCalled();
    expect(tracker.hasTriggered()).toBe(false);

    // Pause resets active accumulation without counting paused time
    tracker.pause();
    vi.advanceTimersByTime(10_000);
    expect(onTrigger).not.toHaveBeenCalled();

    // Resume for 200ms -> total active > 3s (3100ms) -> fires once
    tracker.start();
    vi.advanceTimersByTime(200);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    expect(tracker.hasTriggered()).toBe(true);

    // Additional advances do not fire twice
    vi.advanceTimersByTime(5000);
    expect(onTrigger).toHaveBeenCalledTimes(1);
    tracker.dispose();
  });

  it("detects YouTube, TikTok, and Instagram video URLs inside Coolerup Browser", () => {
    expect(detectExternalVideoSource("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toMatchObject({
      source: "youtube",
      videoId: "yt:dQw4w9WgXcQ",
      youtubeId: "dQw4w9WgXcQ",
    });

    expect(
      detectExternalVideoSource("https://www.tiktok.com/@charlidamelio/video/7123456789012345678"),
    ).toMatchObject({
      source: "tiktok",
      videoId: "tt:7123456789012345678",
      creator: "charlidamelio",
    });

    expect(detectExternalVideoSource("https://www.instagram.com/reel/CxYz123AbC/")).toMatchObject({
      source: "instagram",
      videoId: "ig:CxYz123AbC",
    });
  });

  it("saves newest first per account, survives sign-out isolation, and respects Save Watch History OFF", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);

    await recordWatchHistory("user-a", {
      videoId: "vid-1",
      source: "foryou",
      title: "First Dance",
      creator: "alice",
      videoUrl: "https://example.com/1.mp4",
    });

    vi.setSystemTime(1_760_000_060_000);
    await recordWatchHistory("user-a", {
      videoId: "vid-2",
      source: "videos",
      title: "Second Vlog",
      creator: "bob",
      watchRouteId: "vid-2",
      videoUrl: "https://example.com/2.mp4",
    });

    // Save turned OFF -> third video MUST NOT be recorded
    await writeSaveWatchHistory("user-a", false);
    vi.setSystemTime(1_760_000_120_000);
    const blocked = await recordWatchHistory("user-a", {
      videoId: "vid-3",
      source: "youtube",
      title: "Ignored Video",
      creator: "yt",
      youtubeId: "abc12345678",
    });
    expect(blocked).toBeNull();

    // User A sees [vid-2, vid-1] newest first; User B stays empty
    const listA = await listWatchHistory("user-a");
    expect(listA.map((x) => x.videoId)).toEqual(["vid-2", "vid-1"]);
    expect(await listWatchHistory("user-b")).toEqual([]);

    // Re-enabling ON and deleting one item works cleanly
    await writeSaveWatchHistory("user-a", true);
    await removeWatchHistoryItem("user-a", listA[0]!.id);
    expect((await listWatchHistory("user-a")).map((x) => x.videoId)).toEqual(["vid-1"]);

    await clearWatchHistory("user-a");
    expect(await listWatchHistory("user-a")).toEqual([]);
  });

  it("formats timestamps cleanly and produces valid Firestore doc IDs", () => {
    const now = 1_760_000_000_000;
    expect(formatWatchedWhen(now - 20_000, now)).toBe("Just now");
    expect(formatWatchedWhen(now - 5 * 60_000, now)).toBe("5m ago");
    expect(formatWatchedWhen(now - 2 * 60 * 60_000, now)).toBe("2h ago");
    expect(formatWatchedWhen(now - 26 * 60 * 60_000, now)).toBe("Yesterday");
    const docId = encodeWatchHistoryId("user-alpha", "youtube", "yt:dQw4w9WgXcQ");
    expect(docId.length).toBeLessThanOrEqual(128);
    expect(docId).toMatch(/^[a-zA-Z0-9_-]+$/);
  });

  it("enforces owner-only firestore.rules on watch_history and watch_history_settings", () => {
    const rules = fs.readFileSync(path.resolve("firestore.rules"), "utf8");
    expect(rules).toContain("match /watch_history/{historyDocId}");
    expect(rules).toContain("match /watch_history_settings/{userId}");
    expect(rules).toContain("resource.data.uid == request.auth.uid");
  });
});

describe("WatchHistoryPage UI", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockNavigate.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders black bg, #FE2C55 actions, newest-first list, per-item trash delete, Save toggle, and Clear all history? confirm modal", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_760_000_000_000);
    await recordWatchHistory("user-alpha", {
      videoId: "f1",
      source: "foryou",
      title: "Older Short",
      creator: "creator1",
      videoUrl: "https://example.com/short.mp4",
    });

    vi.setSystemTime(1_760_000_120_000);
    await recordWatchHistory("user-alpha", {
      videoId: "v2",
      source: "videos",
      title: "Latest Full Video",
      creator: "creator2",
      watchRouteId: "v2",
      thumbnailUrl: "https://example.com/thumb.jpg",
    });

    vi.useRealTimers();

    const { container } = render(<WatchHistoryPage />);
    expect(container.firstElementChild?.className).toContain("bg-black");
    expect(container.firstElementChild?.className).toContain("text-white");

    const clearBtn = screen.getByRole("button", { name: "Clear All Watch History" });
    expect(clearBtn).toHaveStyle({ backgroundColor: WATCH_HISTORY_RED });

    const titles = screen.getAllByText(/Latest Full Video|Older Short/);
    expect(titles[0]?.textContent).toBe("Latest Full Video");
    expect(titles[1]?.textContent).toBe("Older Short");

    // Tap video card to watch it again (/watch/$id route)
    fireEvent.click(screen.getByText("Latest Full Video"));
    expect(mockNavigate).toHaveBeenCalledWith({ to: "/watch/$id", params: { id: "v2" } });

    // Trash icon deletes one video from history
    const deleteLatestBtn = screen.getByRole("button", {
      name: "Delete Latest Full Video from history",
    });
    await act(async () => {
      fireEvent.click(deleteLatestBtn);
    });
    expect(screen.queryByText("Latest Full Video")).toBeNull();
    expect(screen.getByText("Older Short")).toBeInTheDocument();

    // Save Watch History toggle ON -> OFF
    const saveToggle = screen.getByRole("switch", { name: "Save Watch History" });
    expect(saveToggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(saveToggle);
    expect(saveToggle).toHaveAttribute("aria-checked", "false");

    // Top "Clear All Watch History" button opens "Clear all history?" popup
    fireEvent.click(clearBtn);
    expect(screen.getByText("Clear all history?")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear All" }));
    });
    expect(screen.queryByText("Older Short")).toBeNull();
    expect(screen.getByText("No watch history yet")).toBeInTheDocument();
  });
});
