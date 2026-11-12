import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QualitySelector } from "@/components/QualitySelector";

describe("QualitySelector", () => {
  it("renders nothing while closed", () => {
    const { container } = render(
      <QualitySelector open={false} quality="auto" onSelect={() => {}} onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("lists every quality with the current one checked", () => {
    render(
      <QualitySelector open quality="720p" effectiveType="4g" onSelect={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByRole("dialog", { name: /video quality/i })).toBeInTheDocument();
    for (const label of ["Auto", "1080p", "720p", "480p", "360p", "Data Saver"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    const active = screen.getByRole("button", { name: /720p/ });
    expect(active).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Auto/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("spells out what Auto is playing", () => {
    render(
      <QualitySelector open quality="auto" effectiveType="3g" onSelect={() => {}} onClose={() => {}} />,
    );
    expect(screen.getByText(/Auto · playing 720p/)).toBeInTheDocument();
  });

  it("selects a quality and closes", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <QualitySelector open quality="auto" onSelect={onSelect} onClose={onClose} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Data Saver/ }));
    expect(onSelect).toHaveBeenCalledWith("data");
    expect(onClose).toHaveBeenCalled();
  });
});
