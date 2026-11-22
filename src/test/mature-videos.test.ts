import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MATURE_BLOCKED_MESSAGE,
  MATURE_LABEL,
  SHOW_MATURE_PREF,
  isAdultBirthday,
  isMatureVideo,
  matureWatchState,
} from "@/lib/matureVideos";

/**
 * 18+ videos are opt-in at post time and gated at watch time by the Date of
 * Birth already on the account. These tests pin the exact rules so a future
 * refactor cannot quietly unlock mature content for under-18 accounts.
 */

const TODAY = new Date("2026-11-22T12:00:00");

describe("isAdultBirthday", () => {
  it("accepts someone whose 18th birthday was yesterday", () => {
    expect(isAdultBirthday("2008-11-21", TODAY)).toBe(true);
  });

  it("accepts the exact 18th birthday", () => {
    expect(isAdultBirthday("2008-11-22", TODAY)).toBe(true);
  });

  it("blocks someone one day short of 18", () => {
    expect(isAdultBirthday("2008-11-23", TODAY)).toBe(false);
  });

  it("treats a missing or malformed birthday as not verified", () => {
    expect(isAdultBirthday(null, TODAY)).toBe(false);
    expect(isAdultBirthday("", TODAY)).toBe(false);
    expect(isAdultBirthday("not-a-date", TODAY)).toBe(false);
  });
});

describe("matureWatchState", () => {
  it("allows an adult", () => {
    expect(matureWatchState("1990-01-01", TODAY)).toEqual({ allowed: true, reason: "ok" });
  });

  it("reports underage with the exact block message", () => {
    const state = matureWatchState("2012-01-01", TODAY);
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe("underage");
    expect(MATURE_BLOCKED_MESSAGE).toBe("You must be 18+ to watch this video");
  });

  it("asks for a birthday when the account has none", () => {
    expect(matureWatchState(null, TODAY)).toEqual({ allowed: false, reason: "no-dob" });
  });
});

describe("isMatureVideo", () => {
  it("is false by default", () => {
    expect(isMatureVideo({})).toBe(false);
    expect(isMatureVideo(null)).toBe(false);
    expect(isMatureVideo({ is_mature: false })).toBe(false);
  });

  it("is true only when the creator opted in", () => {
    expect(isMatureVideo({ is_mature: true })).toBe(true);
  });
});

describe("mature videos SQL", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261220000000_mature_videos.sql"),
    "utf8",
  );

  it("adds the flag to both video tables, OFF by default", () => {
    expect(sql).toContain("alter table public.videos");
    expect(sql).toContain("alter table public.full_videos");
    expect(sql).toContain("is_mature boolean not null default false");
  });

  it("indexes mature rows for feed filtering", () => {
    expect(sql).toContain("videos_is_mature_idx");
    expect(sql).toContain("full_videos_is_mature_idx");
  });
});

describe("posting wiring", () => {
  const upload = readFileSync(resolve(process.cwd(), "src/components/UploadDialog.tsx"), "utf8");
  const uploadFull = readFileSync(resolve(process.cwd(), "src/routes/upload-full.tsx"), "utf8");

  it("shows the 18+ toggle on short-form uploads, OFF by default", () => {
    expect(upload).toContain("MatureVideoFields");
    expect(upload).toContain("useState(false)");
    expect(upload).toContain("matureForPost");
  });

  it("shows the same toggle on long-form uploads", () => {
    expect(uploadFull).toContain("MatureVideoFields");
    expect(uploadFull).toContain("isMature");
  });

  it("labels the toggle exactly", () => {
    const fields = readFileSync(
      resolve(process.cwd(), "src/components/MatureVideoFields.tsx"),
      "utf8",
    );
    expect(fields).toContain("Mark as 18+ — Mature");
    expect(fields).toContain('role="switch"');
  });
});

describe("feed + watch wiring", () => {
  const card = readFileSync(resolve(process.cwd(), "src/components/VideoCard.tsx"), "utf8");
  const watch = readFileSync(resolve(process.cwd(), "src/routes/watch.$id.tsx"), "utf8");
  const feed = readFileSync(resolve(process.cwd(), "src/routes/index.tsx"), "utf8");
  const settings = readFileSync(resolve(process.cwd(), "src/routes/settings.tsx"), "utf8");

  it("blurs the feed thumbnail and shows the label + lock", () => {
    expect(card).toContain("blur-2xl");
    expect(card).toContain("MATURE_LABEL");
    expect(card).toContain("🔒");
  });

  it("blocks playback until unlocked and never autoplays a locked video", () => {
    expect(card).toContain("matureLocked");
    expect(card).toContain("autoplay && !matureLocked");
    expect(watch).toContain("matureLocked");
  });

  it("hides every 18+ video when Show 18+ Videos is off", () => {
    expect(feed).toContain("SHOW_MATURE_PREF");
    expect(feed).toContain("!v.is_mature");
  });

  it("has the Settings > Privacy switch, black background and white text", () => {
    expect(settings).toContain("Show 18+ Videos");
    expect(settings).toContain("setShowMatureVideos");
    expect(settings).toContain("bg-black");
    expect(settings).toContain("text-white");
  });

  it("uses DOB only — no face scan or camera in the gate", () => {
    const lib = readFileSync(resolve(process.cwd(), "src/lib/matureVideos.ts"), "utf8");
    expect(lib).toContain("ageFromBirthday");
    const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(camera|face|facial|selfie|webcam|biometric)\b/i);
    expect(SHOW_MATURE_PREF).toBe("show-mature");
    expect(MATURE_LABEL).toBe("18+ Mature");
  });
});
