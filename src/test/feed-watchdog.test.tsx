import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The feed used to sit on "Loading your feed..." forever when the first request
 * never settled (dead network, stalled proxy, sleeping tab). `load()` now arms a
 * watchdog that flips the feed into its retry state. This test pins that
 * behaviour: a promise that never resolves must still end in a retry message.
 */
vi.mock("@/lib/loop", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/loop")>();
  return {
    ...actual,
    // Never settles: exactly the stall the watchdog exists for.
    fetchVideos: () => new Promise<never>(() => {}),
  };
});

describe("feed watchdog", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("leaves the loading state when the first page never arrives", async () => {
    const origIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;

    try {
      // Install fake timers before the component mounts so the watchdog is
      // scheduled on the fake clock, then jump past it.
      vi.useFakeTimers();
      const { routeTree } = await import("@/routeTree.gen");
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: ["/"] }),
        context: { queryClient: new QueryClient() },
      });

      await act(async () => {
        await router.load();
      });

      render(<RouterProvider router={router} />);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(21_000);
      });
      vi.useRealTimers();

      expect(screen.queryByText("Loading your feed...")).not.toBeInTheDocument();
      expect(screen.getByText("Couldn't load videos. Refresh to try again.")).toBeInTheDocument();
    } finally {
      globalThis.IntersectionObserver = origIO;
    }
  }, 40_000);
});
