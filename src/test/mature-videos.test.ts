import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MATURE_BLOCKED_MESSAGE,
  MATURE_LABEL,
  SHOW_MATURE_PREF,
  isAdultBirthday,
  isMatureVideo,
  matureBlockMessage,
  matureWatchState,
} from "@/lib/matureVideos";

/**
 * 18+ videos are opt-in at post time and gated at watch time by BOTH the Date
 * of Birth on the account and a moderator-approved government ID. A typed
 * birthday alone is self-reported, so it must never unlock adult content.
 * These tests pin the exact rules so a future refactor cannot quietly unlock
 * mature content.
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
  it("allows an adult whose ID is approved", () => {
    expect(matureWatchState("1990-01-01", TODAY, "approved")).toEqual({
      allowed: true,
      reason: "ok",
    });
  });

  it("blocks an adult who has not uploaded an ID yet", () => {
    expect(matureWatchState("1990-01-01", TODAY, "none")).toEqual({
      allowed: false,
      reason: "unverified",
    });
  });

  it("blocks an adult whose ID is still being reviewed", () => {
    expect(matureWatchState("1990-01-01", TODAY, "pending")).toEqual({
      allowed: false,
      reason: "pending",
    });
  });

  it("blocks an adult whose ID was rejected", () => {
    expect(matureWatchState("1990-01-01", TODAY, "rejected")).toEqual({
      allowed: false,
      reason: "rejected",
    });
  });

  it("defaults to unverified when no status is passed", () => {
    expect(matureWatchState("1990-01-01", TODAY).reason).toBe("unverified");
  });

  it("reports underage with the exact block message, even with an approved ID", () => {
    const state = matureWatchState("2012-01-01", TODAY, "approved");
    expect(state.allowed).toBe(false);
    expect(state.reason).toBe("underage");
    expect(MATURE_BLOCKED_MESSAGE).toBe("You must be 18+ to watch this video");
  });

  it("asks for a birthday when the account has none", () => {
    expect(matureWatchState(null, TODAY, "approved")).toEqual({
      allowed: false,
      reason: "no-dob",
    });
  });
});

describe("matureBlockMessage", () => {
  it("returns null only when the viewer is allowed", () => {
    expect(matureBlockMessage("ok")).toBeNull();
  });

  it("gives a distinct next step for every block reason", () => {
    expect(matureBlockMessage("no-dob")).toMatch(/date of birth/i);
    expect(matureBlockMessage("underage")).toBe(MATURE_BLOCKED_MESSAGE);
    expect(matureBlockMessage("unverified")).toMatch(/verify your id/i);
    expect(matureBlockMessage("pending")).toMatch(/reviewed/i);
    expect(matureBlockMessage("rejected")).toMatch(/rejected/i);
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

describe("age verification SQL", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/migrations/20261222000000_age_verification.sql"),
    "utf8",
  );

  it("creates the verification table with a constrained status", () => {
    expect(sql).toContain("create table if not exists public.age_verifications");
    expect(sql).toContain("check (status in ('pending', 'approved', 'rejected'))");
  });

  it("keeps documents in a private bucket", () => {
    expect(sql).toContain("'age-verification'");
    expect(sql).toMatch(/values \('age-verification', 'age-verification', false\)/);
  });

  it("write-locks the table so a user can never approve themselves", () => {
    expect(sql).toContain("revoke insert, update, delete on public.age_verifications");
    // No INSERT/UPDATE policy may exist on the table.
    expect(sql).not.toMatch(/create policy[^;]*on public\.age_verifications[^;]*for insert/i);
    expect(sql).not.toMatch(/create policy[^;]*on public\.age_verifications[^;]*for update/i);
  });

  it("forces submissions to pending and validates the storage path owner", () => {
    expect(sql).toContain("status = 'pending'");
    expect(sql).toContain("split_part(_document_path, '/', 1)");
  });

  it("gates the moderator queue on the admin role", () => {
    expect(sql).toContain("admin_age_verifications");
    expect(sql).toContain("admin_review_age_verification");
    expect(sql).toContain("has_role(_uid, 'admin')");
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
  const loop = readFileSync(resolve(process.cwd(), "src/lib/loop.ts"), "utf8");

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

  it("stops a tap on a locked short-form card from starting playback", () => {
    // togglePlay must bail out before touching the media element.
    const fn = card.slice(card.indexOf("const togglePlay"));
    const body = fn.slice(0, fn.indexOf("};"));
    expect(body).toContain("if (matureLocked)");
    expect(body.indexOf("if (matureLocked)")).toBeLessThan(body.indexOf("el.play()"));
  });

  it("does not load the TikTok embed while a short-form card is locked", () => {
    expect(card).toContain("shouldLoad && !matureLocked");
  });

  it("offers the real-ID check from the lock overlay", () => {
    expect(card).toContain("Verify my ID");
    expect(card).toContain("AgeVerificationDialog");
    expect(watch).toContain("Verify my ID");
    expect(watch).toContain("AgeVerificationDialog");
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

  it("has a Settings row that opens the ID check", () => {
    expect(settings).toContain("Verify your ID for 18+ videos");
    expect(settings).toContain("AgeVerificationDialog");
  });

  it("keeps is_mature in the legacy feed fallback so rows stay gated", () => {
    expect(loop).toContain("LEGACY_COLUMNS");
    const legacy = loop.slice(loop.indexOf("const LEGACY_COLUMNS"));
    expect(legacy.slice(0, 300)).toContain("is_mature");
    expect(loop).toMatch(/is_tiktok\|tiktok_id\|tiktok_author\|is_paid\|price_cents\|is_mature/);
  });

  it("never uses a camera or face scan in the gate", () => {
    const lib = readFileSync(resolve(process.cwd(), "src/lib/matureVideos.ts"), "utf8");
    expect(lib).toContain("ageFromBirthday");
    const code = lib.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/\b(camera|face|facial|webcam|biometric)\b/i);
    expect(SHOW_MATURE_PREF).toBe("show-mature");
    expect(MATURE_LABEL).toBe("18+ Mature");
  });
});
