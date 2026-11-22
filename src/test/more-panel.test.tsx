import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MorePanel } from "@/components/MorePanel";

/**
 * The More page is the only way into the social apps, so these tests cover the
 * grid, the official embed players, and the "Open in App" fallback.
 */
describe("MorePanel", () => {
  it("shows every social app in a grid", () => {
    render(<MorePanel />);
    for (const name of [
      "Facebook",
      "TikTok",
      "Twitch",
      "X",
      "Instagram",
      "YouTube",
      "Snapchat",
      "Reddit",
      "Pinterest",
    ]) {
      expect(screen.getByRole("button", { name: `Open ${name}` })).toBeInTheDocument();
    }
  });

  it("opens YouTube inside Coolerup with the YouTube embed player", () => {
    render(<MorePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open YouTube" }));

    const frame = screen.getByTitle("YouTube embed");
    expect(frame.getAttribute("src")).toContain("https://www.youtube.com/embed/");
  });

  it("swaps the embed when a new link is submitted", () => {
    render(<MorePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open TikTok" }));

    fireEvent.change(screen.getByLabelText("TikTok link"), {
      target: { value: "https://www.tiktok.com/@coolerup/video/7000000000000000000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Embed" }));

    expect(screen.getByTitle("TikTok embed").getAttribute("src")).toBe(
      "https://www.tiktok.com/embed/v2/7000000000000000000",
    );
  });

  it("offers Open in App for apps without an official embed", () => {
    render(<MorePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open Snapchat" }));

    expect(screen.getByText("Snapchat doesn't allow embedding")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Open in App/i }).length).toBeGreaterThan(0);
    expect(screen.queryByTitle("Snapchat embed")).toBeNull();
  });

  it("returns to the grid from a player", () => {
    render(<MorePanel />);
    fireEvent.click(screen.getByRole("button", { name: "Open Instagram" }));
    fireEvent.click(screen.getByRole("button", { name: "Back to More" }));

    expect(screen.getByRole("button", { name: "Open Pinterest" })).toBeInTheDocument();
  });
});
