import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * A post published with a different sound must not offer a way to switch back
 * to the post's original audio. The sound bar is informational only — it shows
 * the chosen sound's title and links to the sound page, but never renders an
 * "Original audio" toggle button on the video/pic.
 */

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to: _to,
    params: _params,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    params?: unknown;
  }) => (
    <a href={`/sound/${(_params as { soundId?: string } | undefined)?.soundId ?? ""}`} {...props}>
      {children}
    </a>
  ),
}));

import { SoundBar } from "@/components/SoundBar";

describe("SoundBar", () => {
  it("shows the chosen sound title but no original-audio button", () => {
    render(<SoundBar soundId="s1" title="Night Drive" creatorUsername="drew" />);

    expect(screen.getAllByText("Night Drive").length).toBeGreaterThan(0);
    expect(screen.queryByText(/original audio/i)).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("links to the sound page without an audio toggle", () => {
    render(<SoundBar soundId="s1" title="Night Drive" creatorUsername="drew" />);

    const link = screen.getByRole("link", { name: /open sound: night drive/i });
    expect(link).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
});
