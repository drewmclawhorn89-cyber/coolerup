import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GifPicker } from "@/components/GifPicker";
import type { GifRow } from "@/lib/gif";

const mockListTrendingGifs = vi.fn();
const mockListMyGifs = vi.fn();
const mockCountMyGifs = vi.fn();
const mockSearchGifs = vi.fn();
const mockSearchGiphy = vi.fn();

vi.mock("@/lib/gif", () => ({
  bumpGifUse: vi.fn(),
  countMyGifs: (...args: unknown[]) => mockCountMyGifs(...args),
  deleteGif: vi.fn(),
  listMyGifs: (...args: unknown[]) => mockListMyGifs(...args),
  listTrendingGifs: (...args: unknown[]) => mockListTrendingGifs(...args),
  reportGif: vi.fn(),
  searchGifs: (...args: unknown[]) => mockSearchGifs(...args),
}));

vi.mock("@/lib/giphy.functions", () => ({
  searchGiphy: (...args: unknown[]) => mockSearchGiphy(...args),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { id: "u1" },
    signIn: vi.fn(),
  }),
}));

function makeGifs(start: number, count: number): GifRow[] {
  return Array.from({ length: count }, (_, idx) => {
    const num = start + idx;
    return {
      id: `gif-${num}`,
      user_id: "u1",
      gif_url: `https://example.com/gif-${num}.gif`,
      title: `Funny Clip ${num}`,
      is_public: true,
      source_video_id: null,
      use_count: 1,
      created_at: "2026-11-14T00:00:00Z",
      username: "drew",
    };
  });
}

describe("GifPicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchGiphy.mockResolvedValue({ ok: true, gifs: [] });
    mockCountMyGifs.mockResolvedValue(4);
    mockListMyGifs.mockResolvedValue(makeGifs(100, 4));
  });

  it("renders a vertically scrollable 3-column grid and auto-loads next 20 GIFs on scroll", async () => {
    const page1 = makeGifs(1, 20);
    const page2 = makeGifs(21, 5);
    let resolvePage2: ((rows: GifRow[]) => void) | null = null;

    mockListTrendingGifs
      .mockResolvedValueOnce(page1)
      .mockImplementationOnce(() => new Promise((r) => (resolvePage2 = r)));

    render(<GifPicker fill onPick={() => {}} onClose={() => {}} />);

    expect(await screen.findByAltText("Funny Clip 1")).toBeInTheDocument();
    expect(screen.getAllByText("Made by @drew").length).toBeGreaterThan(0);

    const grid = screen.getByAltText("Funny Clip 1").closest(".grid");
    expect(grid).toHaveClass("grid-cols-3");

    const scroller = grid?.parentElement?.parentElement;
    expect(scroller).toHaveClass("overflow-y-auto");
    expect(scroller).toHaveClass("max-h-[400px]");

    // Simulate scrolling to the bottom of the container.
    Object.defineProperty(scroller, "scrollHeight", { value: 1000, configurable: true });
    Object.defineProperty(scroller, "clientHeight", { value: 400, configurable: true });
    Object.defineProperty(scroller, "scrollTop", { value: 580, configurable: true });
    fireEvent.scroll(scroller!);

    expect(await screen.findByText("Loading more GIFs...")).toBeInTheDocument();
    expect(mockListTrendingGifs).toHaveBeenLastCalledWith(20, 20);

    resolvePage2!(page2);
    expect(await screen.findByAltText("Funny Clip 21")).toBeInTheDocument();
  });

  it("switches to My GIFs tab and shows count and scrollable grid", async () => {
    mockListTrendingGifs.mockResolvedValue(makeGifs(1, 3));

    render(<GifPicker fill onPick={() => {}} onClose={() => {}} />);

    const myTab = await screen.findByRole("button", { name: "My GIFs (4)" });
    fireEvent.click(myTab);

    await waitFor(() => {
      expect(screen.getByAltText("Funny Clip 100")).toBeInTheDocument();
    });
  });
});
