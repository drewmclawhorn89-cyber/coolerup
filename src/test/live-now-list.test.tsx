import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LiveNowList } from "@/components/LiveNowList";
import type { LiveHost } from "@/lib/liveDirectory";

const host = (userId: string, username: string, title = "Live now"): LiveHost => ({
  userId,
  username,
  title,
  since: 1,
});

/**
 * The LIVE top tab and the /live route share this list, so these tests pin down
 * the two states a viewer can land on: nobody live, and a list of broadcasters.
 */
describe("LiveNowList", () => {
  it("shows the empty state and a Go LIVE action when nobody is streaming", () => {
    const onGoLive = vi.fn();
    render(<LiveNowList hosts={[]} onWatch={vi.fn()} onGoLive={onGoLive} />);
    expect(screen.getByText(/No one is live right now/i)).toBeTruthy();
    screen.getByRole("button", { name: /Go LIVE/i }).click();
    expect(onGoLive).toHaveBeenCalledTimes(1);
  });

  it("lists every broadcaster with a Watch button", () => {
    render(
      <LiveNowList
        hosts={[host("u1", "ana", "Cooking"), host("u2", "ben")]}
        onWatch={vi.fn()}
        onGoLive={vi.fn()}
      />,
    );
    expect(screen.getByText("2 live now")).toBeTruthy();
    expect(screen.getByText("@ana")).toBeTruthy();
    expect(screen.getByText("Cooking")).toBeTruthy();
    expect(screen.getByText("@ben")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Watch/i })).toHaveLength(2);
  });

  it("hands the tapped host to onWatch", () => {
    const onWatch = vi.fn();
    render(<LiveNowList hosts={[host("u1", "ana")]} onWatch={onWatch} onGoLive={vi.fn()} />);
    screen.getByRole("button", { name: /Watch/i }).click();
    expect(onWatch).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", username: "ana" }));
  });
});
