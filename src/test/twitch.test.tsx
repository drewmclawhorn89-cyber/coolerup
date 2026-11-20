import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  buildTwitchChatEmbedUrl,
  buildTwitchParentParams,
  buildTwitchPlayerEmbedUrl,
  formatTwitchThumbnail,
  formatViewerCount,
  normalizeTwitchChannel,
} from "@/lib/twitch";
import { TwitchPanel } from "@/components/TwitchPanel";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

describe("twitch helpers", () => {
  it("formats viewer counts cleanly", () => {
    expect(formatViewerCount(850)).toBe("850");
    expect(formatViewerCount(12450)).toBe("12.4K");
    expect(formatViewerCount(12460)).toBe("12.5K");
    expect(formatViewerCount(2_000_000)).toBe("2M");
  });

  it("formats thumbnail template dimensions", () => {
    expect(
      formatTwitchThumbnail("https://static.twitch.tv/thumb-{width}x{height}.jpg", 440, 248),
    ).toBe("https://static.twitch.tv/thumb-440x248.jpg");
  });

  it("normalizes usernames and twitch.tv URLs", () => {
    expect(normalizeTwitchChannel("@KaiCenat")).toBe("kaicenat");
    expect(normalizeTwitchChannel("https://www.twitch.tv/shroud")).toBe("shroud");
  });

  it("includes hostname and ancestor origins in parent embed params", () => {
    const parents = buildTwitchParentParams("app.example.com", [
      "https://aistudio.google.com",
      "https://app.example.com",
    ]);
    expect(parents).toEqual(["app.example.com", "aistudio.google.com"]);
    expect(buildTwitchPlayerEmbedUrl("shroud", parents)).toContain("channel=shroud");
    expect(buildTwitchPlayerEmbedUrl("shroud", parents)).toContain("parent=aistudio.google.com");
    expect(buildTwitchChatEmbedUrl("shroud", parents)).toContain(
      "https://www.twitch.tv/embed/shroud/chat",
    );
  });
});

describe("TwitchPanel", () => {
  const fetchMock = vi.fn();
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.startsWith("/api/twitch/me")) {
        return Promise.resolve(
          new Response(JSON.stringify({ user: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.startsWith("/api/twitch/streams")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configured: true,
              streams: [
                {
                  id: "s-1",
                  user_id: "u-1",
                  user_login: "kaicenat",
                  user_name: "KaiCenat",
                  game_id: "g-1",
                  game_name: "Just Chatting",
                  title: "Late night IRL stream!",
                  viewer_count: 42300,
                  thumbnail_url: "https://example.com/thumb-{width}x{height}.jpg",
                },
              ],
              games: [
                {
                  id: "g-1",
                  name: "Just Chatting",
                  box_art_url: "https://example.com/game-{width}x{height}.jpg",
                },
              ],
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      if (url.startsWith("/api/twitch/auth/url")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              configured: true,
              url: "https://id.twitch.tv/oauth2/authorize?client_id=abc",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders search bar, LIVE NOW row, BROWSE BY GAME row, and opens full-screen embed player + chat", async () => {
    render(<TwitchPanel />);

    expect(screen.getByPlaceholderText(/Search live streams/i)).toBeInTheDocument();
    expect(screen.getByText("LIVE NOW")).toBeInTheDocument();
    expect(screen.getByText("BROWSE BY GAME")).toBeInTheDocument();

    const streamBtn = await screen.findByText("KaiCenat");
    expect(screen.getByText("42.3K")).toBeInTheDocument();

    fireEvent.click(streamBtn);

    const dialog = await screen.findByRole("dialog", { name: /KaiCenat Twitch player/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByText("KaiCenat")).toBeInTheDocument();
    expect(within(dialog).getByText("Late night IRL stream!")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /^Follow$/i })).toBeInTheDocument();

    const playerFrame = within(dialog).getByTitle(
      "KaiCenat live video player",
    ) as HTMLIFrameElement;
    expect(playerFrame.src).toContain("https://player.twitch.tv/?channel=kaicenat");

    const chatFrame = within(dialog).getByTitle("KaiCenat live chat") as HTMLIFrameElement;
    expect(chatFrame.src).toContain("https://www.twitch.tv/embed/kaicenat/chat");
  });

  it("opens Twitch OAuth provider URL in a popup when Connect Twitch is clicked", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue({ closed: true } as Window);
    render(<TwitchPanel />);

    const connectButtons = await screen.findAllByRole("button", { name: /Connect Twitch/i });
    fireEvent.click(connectButtons[0]!);

    await waitFor(() => {
      expect(openSpy).toHaveBeenCalledWith(
        "https://id.twitch.tv/oauth2/authorize?client_id=abc",
        "twitch_oauth",
        expect.any(String),
      );
    });
    openSpy.mockRestore();
  });
});
