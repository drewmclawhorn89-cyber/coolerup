import { renderToString } from "react-dom/server";
import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnowEffect } from "@/components/SnowEffect";

describe("SSR hydration safety", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T12:00:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders no random snowflake nodes during SSR, then mounts 50 flakes on the client", () => {
    const ssrHtml = renderToString(<SnowEffect />);
    expect(ssrHtml).toBe("");

    const { container } = render(<SnowEffect />);
    expect(container.querySelectorAll(".christmas-flake")).toHaveLength(50);
  });
});
