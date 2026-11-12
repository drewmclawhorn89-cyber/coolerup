import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ChristmasCountdown } from "@/components/ChristmasCountdown";
import { isChristmasCountdownVisible } from "@/lib/christmas";

describe("isChristmasCountdownVisible", () => {
  it("is visible on Nov 1 2026 (today)", () => {
    expect(isChristmasCountdownVisible(new Date("2026-11-01T12:00:00"))).toBe(true);
  });

  it("is visible one second before launch", () => {
    expect(isChristmasCountdownVisible(new Date("2026-11-14T23:59:59"))).toBe(true);
  });

  it("is hidden once the update is live", () => {
    expect(isChristmasCountdownVisible(new Date("2026-11-15T00:00:00"))).toBe(false);
    expect(isChristmasCountdownVisible(new Date("2026-12-25T00:00:00"))).toBe(false);
  });

  it("is hidden after Jan 1 2027", () => {
    expect(isChristmasCountdownVisible(new Date("2027-01-02T00:00:00"))).toBe(false);
  });
});

describe("ChristmasCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts down to Nov 15 2026", () => {
    vi.setSystemTime(new Date("2026-11-10T00:00:00"));
    render(<ChristmasCountdown />);
    expect(screen.getByText(/Christmas Update in 5d 0h 0m 0s/)).toBeTruthy();
  });

  it("ticks down every second", () => {
    vi.setSystemTime(new Date("2026-11-10T00:00:00"));
    render(<ChristmasCountdown />);
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByText(/Christmas Update in 4d 23h 59m 57s/)).toBeTruthy();
  });

  it("hides itself once the update goes live", () => {
    vi.setSystemTime(new Date("2026-11-14T23:59:58"));
    const { container } = render(<ChristmasCountdown />);
    expect(container.textContent).toContain("Christmas Update in");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.textContent).toBe("");
  });

  it("renders nothing after Jan 1 2027", () => {
    vi.setSystemTime(new Date("2027-02-01T00:00:00"));
    const { container } = render(<ChristmasCountdown />);
    expect(container.textContent).toBe("");
  });
});
