import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { OnlineDot, OnlineStatusSubtitle } from "@/components/OnlineStatusBadge";
import { AuthProvider } from "@/hooks/useAuth";
import {
  createPresenceActivityController,
  formatLastActive,
  formatOfflineActivity,
  getVisiblePresence,
  INACTIVITY_TIMEOUT_MS,
  ONLINE_DOT_COLOR,
  presenceDocId,
  resetPresenceCacheForTest,
  seedPresenceRecordForTest,
  useOnlineStatus,
  useShowOnlineSetting,
  writeShowOnlineSetting,
} from "@/lib/onlineStatus";

function PresenceHarness({ targetHandle }: { targetHandle: string }) {
  const status = useOnlineStatus(targetHandle);
  const [showOnline, setShowOnline] = useShowOnlineSetting();
  return (
    <div>
      <button type="button" onClick={() => setShowOnline(!showOnline)}>
        {showOnline ? "Privacy ON" : "Privacy OFF"}
      </button>
      <OnlineDot visible={status.visible && status.isOnline} />
      {status.visible && !status.isOnline && <OnlineStatusSubtitle status={status} />}
    </div>
  );
}

describe("online status formatting & privacy", () => {
  const baseNow = 1_760_000_000_000;

  beforeEach(() => {
    window.localStorage.clear();
    resetPresenceCacheForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPresenceCacheForTest();
  });

  it("formats offline timestamps as Active 5m ago, Active 2h ago, and Active yesterday", () => {
    expect(formatOfflineActivity(baseNow - 20_000, baseNow)).toBe("Active just now");
    expect(formatOfflineActivity(baseNow - 5 * 60_000, baseNow)).toBe("Active 5m ago");
    expect(formatOfflineActivity(baseNow - 2 * 60 * 60_000, baseNow)).toBe("Active 2h ago");
    expect(formatOfflineActivity(baseNow - 26 * 60 * 60_000, baseNow)).toBe("Active yesterday");
    expect(formatOfflineActivity(baseNow - 3 * 24 * 60 * 60_000, baseNow)).toBe("Active 3d ago");
    expect(formatLastActive(baseNow - 10_000, true, baseNow)).toBe("Active now");
  });

  it("enforces reciprocal privacy when viewer or target turns Show when I'm online OFF", () => {
    const aliceOnline = {
      handle: "alice",
      isOnline: true,
      lastActive: baseNow - 30_000,
      showOnline: true,
    };

    expect(getVisiblePresence(aliceOnline, true, baseNow)).toEqual({
      visible: true,
      isOnline: true,
      statusText: null,
    });

    // Viewer turned "Show when I'm online" OFF -> viewer sees nothing.
    expect(getVisiblePresence(aliceOnline, false, baseNow)).toEqual({
      visible: false,
      isOnline: false,
      statusText: null,
    });

    // Target turned "Show when I'm online" OFF -> viewer sees nothing.
    expect(
      getVisiblePresence({ ...aliceOnline, isOnline: false, showOnline: false }, true, baseNow),
    ).toEqual({
      visible: false,
      isOnline: false,
      statusText: null,
    });
  });

  it("treats stale online sessions (> 6 min without heartbeat) as offline", () => {
    const stale = {
      handle: "bob",
      isOnline: true,
      lastActive: baseNow - 10 * 60_000,
      showOnline: true,
    };
    expect(getVisiblePresence(stale, true, baseNow)).toEqual({
      visible: true,
      isOnline: false,
      statusText: "Active 10m ago",
    });
  });

  it("builds valid Firestore document IDs matching ^[a-zA-Z0-9_-]+$ even for dotted handles", () => {
    const id = presenceDocId("Cool.User_1");
    expect(id).toBe("h_cool_d_user__1");
    expect(id).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe("5-minute inactivity timer & live status component", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetPresenceCacheForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetPresenceCacheForTest();
  });

  it("marks user Offline and saves lastActive after 5 minutes of inactivity, and restores Online on activity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
    const published: Array<{ isOnline: boolean; lastActive: number; showOnline: boolean }> = [];

    const controller = createPresenceActivityController({
      inactivityMs: INACTIVITY_TIMEOUT_MS,
      getShowOnline: () => true,
      onPublish: (s) => published.push(s),
    });

    controller.markOnline(true);
    expect(controller.isOnline).toBe(true);
    expect(published.at(-1)?.isOnline).toBe(true);

    // 4m 59s -> still online
    vi.advanceTimersByTime(INACTIVITY_TIMEOUT_MS - 1000);
    expect(controller.isOnline).toBe(true);

    // Crossing 5m -> automatically offline with saved lastActive timestamp
    vi.advanceTimersByTime(1000);
    expect(controller.isOnline).toBe(false);
    expect(published.at(-1)).toEqual({
      isOnline: false,
      lastActive: Date.now(),
      showOnline: true,
    });

    // Activity brings user back online immediately
    controller.markOnline(false);
    expect(controller.isOnline).toBe(true);
    expect(published.at(-1)?.isOnline).toBe(true);

    controller.dispose();
  });

  it("renders green #25D366 dot when online, switches live to Active 5m ago when offline, and hides when privacy is OFF", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-20T12:05:00Z"));
    seedPresenceRecordForTest({
      handle: "friend",
      isOnline: true,
      lastActive: Date.now(),
      showOnline: true,
    });

    render(
      <AuthProvider>
        <PresenceHarness targetHandle="friend" />
      </AuthProvider>,
    );

    const dot = screen.getByTestId("online-dot");
    expect(dot).toBeInTheDocument();
    expect(ONLINE_DOT_COLOR).toBe("#25D366");
    expect(dot.className).toContain("bg-[#25D366]");
    expect(screen.queryByTestId("last-active-text")).not.toBeInTheDocument();

    // Friend goes offline 5 minutes ago -> live update without refresh
    act(() => {
      seedPresenceRecordForTest({
        handle: "friend",
        isOnline: false,
        lastActive: Date.now() - 5 * 60_000,
        showOnline: true,
      });
    });

    expect(screen.queryByTestId("online-dot")).not.toBeInTheDocument();
    expect(screen.getByTestId("last-active-text")).toHaveTextContent("Active 5m ago");

    // Viewer toggles "Show when I'm online" OFF -> can't see others' status either
    act(() => {
      writeShowOnlineSetting(false);
    });

    expect(screen.queryByTestId("online-dot")).not.toBeInTheDocument();
    expect(screen.queryByTestId("last-active-text")).not.toBeInTheDocument();
  });
});

describe("hardened firestore.rules invariants", () => {
  it("enforces Master Gate deny, strict schema keys, server request.time, and showOnline read privacy", () => {
    const rules = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain("allow read, write: if false;");
    expect(rules).toContain("isValidUserPresence(incoming())");
    expect(rules).toContain("existing().showOnline == true");
    expect(rules).toContain("incoming().lastActive == request.time");
    expect(rules).toContain("incoming().createdAt == existing().createdAt");
    expect(rules).toContain("affectedKeys().hasOnly(['isOnline', 'lastActive', 'showOnline'])");
  });
});
