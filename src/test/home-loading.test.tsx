import { QueryClient } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";

describe("App root & home route loading", () => {
  it("loads / without throwing or getting stuck on Loading your feed forever", async () => {
    const errors: unknown[] = [];
    const origErr = console.error;
    console.error = (...args: unknown[]) => {
      const first = String(args[0] ?? "");
      if (first.includes("empty string") || first.includes("cannot be a child of")) return;
      errors.push(args);
    };

    const origIO = globalThis.IntersectionObserver;
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof IntersectionObserver;

    try {
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: ["/"] }),
        context: { queryClient: new QueryClient() },
      });

      await act(async () => {
        await router.load();
      });

      render(<RouterProvider router={router} />);

      await waitFor(
        () => {
          expect(screen.queryByText("Loading your feed...")).not.toBeInTheDocument();
        },
        { timeout: 3000 },
      );

      expect(errors).toEqual([]);
    } finally {
      console.error = origErr;
      globalThis.IntersectionObserver = origIO;
    }
  });

  it("renders /settings safely when an old subscription link is opened and storage is blocked", async () => {
    const origErr = console.error;
    const errors: unknown[] = [];
    console.error = (...args: unknown[]) => {
      const first = String(args[0] ?? "");
      if (first.includes("empty string") || first.includes("cannot be a child of")) return;
      errors.push(args);
    };

    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });

    try {
      const router = createRouter({
        routeTree,
        history: createMemoryHistory({ initialEntries: ["/settings?subscriptions=1"] }),
        context: { queryClient: new QueryClient() },
      });

      await act(async () => {
        await router.load();
      });

      render(<RouterProvider router={router} />);

      await waitFor(() => {
        expect(screen.getByText("Settings")).toBeInTheDocument();
      });
      expect(errors).toEqual([]);
    } finally {
      getItemSpy.mockRestore();
      console.error = origErr;
    }
  });
});
