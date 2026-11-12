import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { canBackgroundPlay, isYouTubeTrack as isYouTubeBackgroundTrack } from "@/lib/backgroundPlay";
import { isYouTubeTrack, trackYouTubeId, type PlayerTrack } from "@/lib/songPlayer";

const root = join(__dirname, "..", "..");
const youtubeAudio = readFileSync(join(root, "src/lib/youtubeAudio.ts"), "utf8");
const player = readFileSync(join(root, "src/lib/songPlayer.ts"), "utf8");
const background = readFileSync(join(root, "src/lib/backgroundPlay.ts"), "utf8");
const music = readFileSync(join(root, "src/routes/music.tsx"), "utf8");

const track = (patch: Partial<PlayerTrack> = {}): PlayerTrack => ({
  soundId: "s1",
  title: "Night Drive",
  artist: "MGK",
  url: "",
  cover: "linear-gradient(#000,#111)",
  source: "youtube",
  youtubeUrl: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  ...patch,
});

describe("YouTube background play", () => {
  it("recognises YouTube tracks and pulls out the video id", () => {
    expect(isYouTubeTrack(track())).toBe(true);
    expect(trackYouTubeId(track())).toBe("dQw4w9WgXcQ");
    expect(isYouTubeTrack(track({ youtubeUrl: null }))).toBe(false);
    expect(isYouTubeTrack(track({ source: "own" }))).toBe(false);
    expect(isYouTubeTrack(null)).toBe(false);
  });

  it("lets YouTube tracks qualify for background play", () => {
    expect(canBackgroundPlay(track())).toBe(true);
    expect(isYouTubeBackgroundTrack(track())).toBe(true);
    expect(isYouTubeBackgroundTrack(track({ source: "own" }))).toBe(false);
  });

  it("owns one hidden IFrame player outside any route", () => {
    expect(youtubeAudio).toContain("coolerup-youtube-audio");
    expect(youtubeAudio).toContain("document.body.appendChild");
    expect(youtubeAudio).toContain("position:fixed");
    // Kept rendered (1x1, nearly transparent) — YouTube refuses to play in a
    // display:none element.
    expect(youtubeAudio).toContain("opacity:0.01");
    expect(youtubeAudio).toContain("loadVideoById");
    expect(youtubeAudio).toContain("pauseVideo");
    expect(youtubeAudio).toContain("seekTo");
  });

  it("routes the shared player's YouTube branches through that backend", () => {
    expect(player).toContain("loadYouTubeAudio");
    expect(player).toContain("pauseYouTubeAudio");
    expect(player).toContain("stopYouTubeAudio");
    expect(player).toContain("setYouTubeAudioListeners");
  });

  it("spoofs page visibility only while a YouTube song is playing", () => {
    expect(background).toContain("installVisibilitySpoof");
    expect(background).toContain("removeVisibilitySpoof");
    expect(background).toContain("visibilityState");
    expect(background).toContain("isYouTubeTrack(track)");
  });

  it("sends YouTube songs from the Music tab into the shared queue", () => {
    expect(music).toContain("songPlayer.playQueue(queue, at)");
    expect(music).not.toContain("setActiveYouTube");
  });
});
