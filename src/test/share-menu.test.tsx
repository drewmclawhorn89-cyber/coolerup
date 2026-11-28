import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareMenu } from "@/components/ShareMenu";
import { QualitySelector } from "@/components/QualitySelector";
import { useBottomSheetOpen } from "@/lib/commentsOverlay";
import type { Video } from "@/lib/loop";

let mockHandle: string | null = "viewer";
let mockUser: { id: string } | null = { id: "u-viewer" };
let mockOfflineUnlocked = true;

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    avatar: null,
    handle: mockHandle,
    signIn: vi.fn(),
    user: mockUser,
  }),
}));

vi.mock("@/lib/subscriptions", () => ({
  useOfflineUnlocked: () => mockOfflineUnlocked,
}));

vi.mock("@/lib/offline", () => ({
  getSaved: vi.fn().mockResolvedValue(null),
  removeOffline: vi.fn().mockResolvedValue(undefined),
  saveOffline: vi.fn().mockResolvedValue(1024),
  formatBytes: (n: number) => `${n} B`,
}));

vi.mock("@/components/OfflinePaywallDialog", () => ({
  OfflinePaywallDialog: () => null,
}));

vi.mock("@/components/EditVideoDialog", () => ({
  EditVideoDialog: () => null,
}));

const sampleVideo: Video = {
  id: "v-123",
  username: "creator",
  caption: "Test video",
  video_url: "https://cdn.example.com/v.mp4",
  likes: 10,
  created_at: "2026-11-26T00:00:00Z",
};

describe("ShareMenu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHandle = "viewer";
    mockUser = { id: "u-viewer" };
    mockOfflineUnlocked = true;
  });

  it("portals solid theme sheet above bottom nav, hides bottom nav, and closes on X", () => {
    function NavWatcher() {
      const hidden = useBottomSheetOpen();
      return <div data-testid="bottom-nav-hidden">{String(hidden)}</div>;
    }

    const onClose = vi.fn();
    const { rerender } = render(
      <>
        <NavWatcher />
        <div style={{ contain: "layout paint style" }}>
          <ShareMenu
            video={sampleVideo}
            qualityLabel="Auto"
            onOpenQuality={() => {}}
            onReport={() => {}}
            onClose={onClose}
            onShared={() => {}}
          />
        </div>
      </>,
    );

    expect(screen.getByTestId("bottom-nav-hidden")).toHaveTextContent("true");

    const dialog = screen.getByRole("dialog", { name: "Share" });
    expect(dialog.parentElement).toBe(document.body);

    const aside = dialog.querySelector("aside");
    expect(aside).not.toBeNull();
    expect(aside?.className).toContain("fixed");
    expect(aside?.className).toContain("bottom-0");
    expect(aside?.className).toContain("left-0");
    expect(aside?.className).toContain("w-screen");
    expect(aside?.className).toContain("bg-background");
    expect(aside?.className).toContain("text-white");

    // No raw link URL peeking out at the bottom of the sheet.
    expect(aside?.textContent).not.toContain("/v/v-123");

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(<NavWatcher />);
    expect(screen.getByTestId("bottom-nav-hidden")).toHaveTextContent("false");
  });

  it("aligns the 4x2 grid with 64px circle icons and preserves empty slots in row 2", () => {
    render(
      <ShareMenu
        video={sampleVideo}
        qualityLabel="Auto"
        onOpenQuality={() => {}}
        onReport={() => {}}
        onClose={() => {}}
        onShared={() => {}}
      />,
    );

    const labels = ["Share", "Copy link", "Download", "Save offline", "Quality · Auto", "Report"];
    for (const label of labels) {
      const btn = screen.getByRole("button", { name: label });
      const circle = btn.querySelector("div");
      expect(circle?.className).toContain("h-16");
      expect(circle?.className).toContain("w-16");
    }

    const shareBtn = screen.getByRole("button", { name: "Share" });
    const copyBtn = screen.getByRole("button", { name: "Copy link" });
    const downloadBtn = screen.getByRole("button", { name: "Download" });
    const offlineBtn = screen.getByRole("button", { name: "Save offline" });
    const qualityBtn = screen.getByRole("button", { name: "Quality · Auto" });
    const reportBtn = screen.getByRole("button", { name: "Report" });

    expect(shareBtn.className).toContain("col-start-1 row-start-1");
    expect(copyBtn.className).toContain("col-start-2 row-start-1");
    expect(downloadBtn.className).toContain("col-start-3 row-start-1");
    expect(offlineBtn.className).toContain("col-start-4 row-start-1");
    expect(qualityBtn.className).toContain("col-start-1 row-start-2");
    expect(reportBtn.className).toContain("col-start-2 row-start-2");

    // Columns 3 & 4 of row 2 are explicit blank spacers for non-owners.
    const grid = shareBtn.parentElement;
    expect(grid?.children).toHaveLength(8);
    expect(grid?.children[6]?.getAttribute("aria-hidden")).toBe("true");
    expect(grid?.children[7]?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps Report in column 2 even when Quality is omitted, and hides Share URL footer", () => {
    render(
      <ShareMenu video={sampleVideo} onReport={() => {}} onClose={() => {}} onShared={() => {}} />,
    );

    const reportBtn = screen.getByRole("button", { name: "Report" });
    expect(reportBtn.className).toContain("col-start-2 row-start-2");
  });

  it("also hides bottom nav when QualitySelector is open and enforces theme/safe-area in source", () => {
    function NavWatcher() {
      const hidden = useBottomSheetOpen();
      return <div data-testid="bottom-nav-hidden">{String(hidden)}</div>;
    }

    const { rerender } = render(
      <>
        <NavWatcher />
        <QualitySelector open quality="auto" onSelect={() => {}} onClose={() => {}} />
      </>,
    );
    expect(screen.getByTestId("bottom-nav-hidden")).toHaveTextContent("true");

    rerender(
      <>
        <NavWatcher />
        <QualitySelector open={false} quality="auto" onSelect={() => {}} onClose={() => {}} />
      </>,
    );
    expect(screen.getByTestId("bottom-nav-hidden")).toHaveTextContent("false");

    const shareSource = readFileSync(join(__dirname, "..", "components", "ShareMenu.tsx"), "utf8");
    expect(shareSource).toContain('backgroundColor: "var(--background)"');
    expect(shareSource).toContain("calc(env(safe-area-inset-bottom) + 16px)");
  });
});
