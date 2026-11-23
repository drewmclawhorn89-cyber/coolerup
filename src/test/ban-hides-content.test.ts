import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { isBannedAuthor, normaliseHandle } from "@/lib/safety";

/**
 * A ban must remove the account's whole catalogue, not just stop them signing
 * in. These tests pin the three layers that make that true:
 *   1. the migration (RLS + trigger + backfill),
 *   2. the client filter helpers,
 *   3. the screens that consume them.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const MIGRATION = "supabase/migrations/20261223000000_ban_hides_content.sql";

describe("ban migration", () => {
  const sql = read(MIGRATION);

  it("exposes the ban lookups the client needs", () => {
    expect(sql).toContain("create or replace function public.account_is_banned");
    expect(sql).toContain("create or replace function public.handle_is_banned");
    expect(sql).toContain("create or replace function public.banned_handles");
    expect(sql).toContain(
      "grant execute on function public.banned_handles() to anon, authenticated",
    );
  });

  it("only counts bans that are still active", () => {
    expect(sql).toMatch(
      /is_permanent[\s\S]{0,120}expires_at is null[\s\S]{0,120}expires_at > now\(\)/,
    );
  });

  it("blocks banned authors at the row level on both video tables", () => {
    for (const table of ["public.videos", "public.full_videos"]) {
      const policy = new RegExp(
        `create policy "banned authors are hidden"\\s+on ${table.replace(".", "\\.")}\\s+as restrictive`,
      );
      expect(sql).toMatch(policy);
    }
  });

  it("keeps admins able to moderate banned content", () => {
    expect(sql).toContain("public.has_role(auth.uid(), 'admin')");
  });

  it("mirrors a ban into videos.hidden with a recognisable reason", () => {
    expect(sql).toContain("create or replace function public.ban_hides_author_content");
    expect(sql).toContain("hidden_reason = 'Author banned'");
    expect(sql).toContain("create trigger ban_hides_author_content");
    expect(sql).toContain("create trigger unban_restores_author_content");
  });

  it("only restores rows the ban itself hid", () => {
    expect(sql).toMatch(/hidden_reason = null[\s\S]{0,200}where hidden_reason = 'Author banned'/);
    // A moderator-hidden video must never be resurrected by an unban.
    expect(sql).toContain("where hidden_reason = 'Author banned'");
  });

  it("backfills bans that already exist", () => {
    expect(sql).toMatch(/update public\.videos[\s\S]{0,400}account_is_banned/);
  });
});

describe("normaliseHandle", () => {
  it("treats @Cooler, cooler and '  @COOLER ' as the same account", () => {
    expect(normaliseHandle("@Cooler")).toBe("cooler");
    expect(normaliseHandle("cooler")).toBe("cooler");
    expect(normaliseHandle("  @COOLER ")).toBe("cooler");
    expect(normaliseHandle("@@cooler")).toBe("cooler");
  });

  it("returns an empty string for missing handles", () => {
    expect(normaliseHandle(undefined)).toBe("");
    expect(normaliseHandle(null)).toBe("");
    expect(normaliseHandle("   ")).toBe("");
  });
});

describe("isBannedAuthor", () => {
  const banned = new Set(["spammer"]);

  it("matches regardless of @ or casing", () => {
    expect(isBannedAuthor(banned, "spammer")).toBe(true);
    expect(isBannedAuthor(banned, "@Spammer")).toBe(true);
  });

  it("leaves everyone else alone", () => {
    expect(isBannedAuthor(banned, "cooler")).toBe(false);
    expect(isBannedAuthor(banned, undefined)).toBe(false);
    expect(isBannedAuthor(new Set(), "spammer")).toBe(false);
  });
});

describe("screens filter banned authors", () => {
  it("the feed drops banned authors", () => {
    const feed = read("src/routes/index.tsx");
    expect(feed).toContain("useBannedHandles()");
    expect(feed).toContain("isBannedAuthor(bannedHandles, v.username)");
  });

  it("search drops banned videos and profiles", () => {
    const search = read("src/lib/search.ts");
    expect(search).toContain("loadBannedHandles");
    expect(search).toContain("isBannedAuthor(banned, video.username)");
    expect(search).toContain("isBannedAuthor(banned, user.handle)");
    // Hashtags are built from video results, so they inherit the filter.
    expect(search).toContain("const videos = await searchVideos(term, 100)");
  });

  it("a banned profile shows the ban notice instead of a grid", () => {
    const profile = read("src/routes/u.$username.tsx");
    expect(profile).toContain("useIsBanned(username)");
    expect(profile).toContain("{BANNED_TEXT}");
    expect(profile).toContain("if (banned && !isOwn)");
  });

  it("long-form lists drop banned authors", () => {
    const full = read("src/lib/fullVideos.ts");
    expect(full).toContain("withoutBannedAuthors");
    expect(full).toContain("isBannedAuthor(banned, row.username)");
  });
});
