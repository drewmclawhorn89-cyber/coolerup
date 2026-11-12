import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canBackgroundPlay, isBackgroundPlayEnabled } from "@/lib/backgroundPlay";
import type { PlayerTrack } from "@/lib/songPlayer";

const root = join(__dirname, "..", "..");
const lib = readFileSync(join(root, "src/lib/backgroundPlay.ts"), "utf8");
const mini = readFileSync(join(root, "src/components/MiniPlayer.tsx"), "utf8");
const player = readFileSync(join(root, "src/lib/songPlayer.ts"), "utf8");
const music = readFileSync(join(root, "src/routes/music.tsx"), "utf8");
const settings = readFileSync(join(root, "src/routes/settings.tsx"), "utf8");
const rootLayout = readFileSync(join(root, "src/routes/__root.tsx"), "utf8");

const track = (patch: Partial<PlayerTrack> = {}): PlayerTrack => ({
  soundId: "s1",
  title: "Night Drive",
  artist: "@drew",
  url: "https://example.com/a.mp3",
  cover: "linear-gradient(#000,#111)",
  ...patch,
});

describe("background play", () => {
  it("is ON by default", () => {
    localStorage.removeItem("settings:background-play");
    expect(isBackgroundPlayEnabled()).toBe(true);
  });

  it("allows own MP3s and downloaded audio to play in the background", () => {
    expect(canBackgroundPlay(track())).toBe(true);
    expect(canBackgroundPlay(track({ source: "own" }))).toBe(true);
    expect(canBackgroundPlay(null)).toBe(false);
  });

  it("knows YouTube cannot play in the background", () => {
    expect(canBackgroundPlay(track({ source: "youtube" }))).toBe(false);
  });

  it("publishes Media Session metadata and action handlers", () => {
    expect(lib).toContain("navigator");
    expect(lib).toContain("mediaSession");
    expect(lib).toContain("MediaMetadata");
    expect(lib).toContain('setActionHandler("play"');
    expect(lib).toContain('setActionHandler("pause"');
    expect(lib).toContain('setActionHandler("nexttrack"');
    expect(lib).toContain('setActionHandler("previoustrack"');
  });

  it("uses an <audio> element, not a <video> tag", () => {
    expect(player).toContain("new Audio()");
    expect(player).not.toContain("new Video(");
  });

  it("shows the YouTube warning instead of pretending it works", () => {
    expect(lib).toContain("YouTube blocks background play");
    expect(mini).toContain("YOUTUBE_BACKGROUND_SHORT");
    expect(music).toContain("YOUTUBE_BACKGROUND_WARNING");
  });

  it("renders a persistent mini player with cover, play/pause, next and close", () => {
    expect(rootLayout).toContain("<MiniPlayer />");
    expect(mini).toContain('aria-label="Next song"');
    expect(mini).toContain('aria-label="Close player"');
    expect(mini).toContain("player.playing ? \"Pause\" : \"Play\"");
  });

  it("opens the full player when the bar is tapped", () => {
    expect(mini).toContain('navigate({ to: "/music" })');
  });

  it("has a Settings -> Music -> Background Play toggle", () => {
    expect(settings).toContain("Background Play");
    expect(settings).toContain("setBackgroundPlayEnabled");
    expect(settings).toContain("useBackgroundPlay()");
  });

  it("has a Background Play button in the Music tab", () => {
    expect(music).toContain("Background Play");
    expect(music).toContain("setBackgroundPlayEnabled");
  });
});
