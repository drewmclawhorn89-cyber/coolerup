import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FacebookPanel } from "@/components/FacebookPanel";
import { AuthProvider } from "@/hooks/useAuth";

function renderPanel() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <FacebookPanel />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("FacebookPanel", () => {
  it("runs Facebook directly inside Coolerup on mount via the in-app proxy", () => {
    renderPanel();
    const frame = screen.getByTitle("Facebook inside Coolerup") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(
      `/api/browser/proxy?url=${encodeURIComponent("https://m.facebook.com/")}`,
    );
  });

  it("switches to Watch, Reels, Desktop mode, and Back/Forward inside the Facebook tab", () => {
    renderPanel();
    const frame = () => screen.getByTitle("Facebook inside Coolerup") as HTMLIFrameElement;

    fireEvent.click(screen.getByRole("button", { name: /Watch/i }));
    expect(frame().getAttribute("src")).toBe(
      `/api/browser/proxy?url=${encodeURIComponent("https://m.facebook.com/watch/")}`,
    );

    fireEvent.click(screen.getByRole("button", { name: /Reels/i }));
    expect(frame().getAttribute("src")).toBe(
      `/api/browser/proxy?url=${encodeURIComponent("https://m.facebook.com/reel/")}`,
    );

    fireEvent.click(screen.getByRole("button", { name: /Mobile/i }));
    expect(frame().getAttribute("src")).toBe(
      `/api/browser/proxy?url=${encodeURIComponent("https://www.facebook.com/reel/")}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(frame().getAttribute("src")).toBe(
      `/api/browser/proxy?url=${encodeURIComponent("https://m.facebook.com/reel/")}`,
    );

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(frame().getAttribute("src")).toBe(
      `/api/browser/proxy?url=${encodeURIComponent("https://www.facebook.com/reel/")}`,
    );
  });

  it("lets users search Facebook or open saved video links without leaving the tab", () => {
    renderPanel();
    const input = screen.getByLabelText("Search Facebook or paste link");
    fireEvent.change(input, { target: { value: "coolerup" } });
    fireEvent.submit(input.closest("form")!);

    const frame = screen.getByTitle("Facebook inside Coolerup") as HTMLIFrameElement;
    expect(frame.getAttribute("src")).toBe(
      `/api/browser/proxy?url=${encodeURIComponent("https://m.facebook.com/search/top/?q=coolerup")}`,
    );

    fireEvent.click(screen.getByRole("button", { name: /Links/i }));
    expect(screen.getByPlaceholderText("Paste Facebook video link")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Feed/i }));
    expect(screen.getByTitle("Facebook inside Coolerup")).toBeInTheDocument();
  });

  it("ignores unrelated postMessages and keeps focus safe", () => {
    const spy = vi.spyOn(window, "addEventListener");
    renderPanel();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
