import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Everything moderation took down has to come back on its own — no button, no
 * page. These tests pin the two halves that make that true:
 *   1. the migration (columns, archive, restore function, one-time run),
 *   2. the app shell calling the restore on load.
 */

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const MIGRATION = "supabase/migrations/20261229000000_restore_taken_down_content.sql";

describe("restore migration", () => {
  const sql = read(MIGRATION);

  it("adds the soft-delete and ban columns", () => {
    expect(sql).toContain("add column if not exists is_deleted");
    expect(sql).toContain("add column if not exists is_hidden");
    expect(sql).toContain("add column if not exists status");
    expect(sql).toContain("add column if not exists deleted_at");
    expect(sql).toContain("add column if not exists is_banned");
    expect(sql).toContain("add column if not exists is_muted");
    expect(sql).toContain("add column if not exists warning_count");
    expect(sql).toContain("add column if not exists ban_reason");
    expect(sql).toContain("add column if not exists mute_until");
  });

  it("defines the restore function and runs it once", () => {
    expect(sql).toContain("create or replace function public.restore_all_taken_down_content()");
    expect(sql).toMatch(/select public\.restore_all_taken_down_content\(\);/);
    expect(sql).toContain("grant execute on function public.restore_all_taken_down_content()");
  });

  it("un-hides videos and clears deleted flags", () => {
    expect(sql).toMatch(/set hidden = false[\s\S]{0,200}is_deleted = false/);
    expect(sql).toMatch(/update public\.comments[\s\S]{0,200}is_deleted = false/);
    expect(sql).toMatch(/update public\.direct_messages[\s\S]{0,120}is_deleted = false/);
  });

  it("unbans accounts and removes the ban records", () => {
    expect(sql).toMatch(/set is_banned = false[\s\S]{0,200}warning_count = 0/);
    expect(sql).toMatch(/delete from public\.banned_users/);
    expect(sql).toMatch(/delete from public\.user_strikes/);
    expect(sql).toMatch(/delete from public\.identity_bans/);
  });

  it("archives hard deletes so they can be restored", () => {
    expect(sql).toContain("create table if not exists public.deleted_content");
    expect(sql).toContain("jsonb_populate_record");
  });

  it("does not add a restore button or page", () => {
    expect(sql).not.toMatch(/create policy .*restore/i);
  });
});

describe("restore on app load", () => {
  it("is called from the root shell", () => {
    const root = read("src/routes/__root.tsx");
    expect(root).toContain("restoreTakenDownContent");
    expect(root).toMatch(/void restoreTakenDownContent\(\)/);
  });

  it("calls the database function once per session", () => {
    const lib = read("src/lib/restoreContent.ts");
    expect(lib).toContain('"restore_all_taken_down_content"');
    expect(lib).toContain("sessionStorage");
  });

  it("archives the row before an admin delete", () => {
    const server = read("src/lib/reportEmail.server.ts");
    expect(server).toContain("archiveThenDelete");
    expect(server).toMatch(/from\("deleted_content"\)/);
  });
});
