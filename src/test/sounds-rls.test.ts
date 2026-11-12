import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static guards for the sounds RLS / storage security fix.
 *
 * There is no Postgres in CI, so these tests read the migration and assert the
 * security-critical statements are present. They exist to stop a future
 * migration from quietly re-opening `sounds` to every signed-in user, which is
 * exactly the bug this fix closes.
 */

const ROOT = path.resolve(__dirname, "../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const FIX = readFileSync(path.join(MIGRATIONS, "20261203000000_fix_sounds_rls.sql"), "utf8");

/** Collapse whitespace so assertions don't depend on formatting. */
const flat = (sql: string) => sql.replace(/\s+/g, " ").toLowerCase();

describe("sounds RLS migration", () => {
  it("enables row level security on sounds", () => {
    expect(flat(FIX)).toContain("alter table public.sounds enable row level security");
  });

  it("drops the old over-permissive policies", () => {
    const sql = flat(FIX);
    expect(sql).toContain('drop policy if exists "sounds are public" on public.sounds');
    expect(sql).toContain('drop policy if exists "signed in users create sounds" on public.sounds');
    expect(sql).toContain('drop policy if exists "creators update own sounds" on public.sounds');
  });

  it("lets everyone read sounds so the Music tab works", () => {
    const sql = flat(FIX);
    expect(sql).toContain('create policy "public read sounds"');
    expect(sql).toMatch(
      /public read sounds" on public\.sounds for select to anon, authenticated using \(true\)/,
    );
  });

  it("scopes insert, update and delete to the owner", () => {
    const sql = flat(FIX);
    expect(sql).toMatch(
      /owner insert sounds" on public\.sounds for insert to authenticated with check \(auth\.uid\(\) = user_id\)/,
    );
    expect(sql).toMatch(
      /owner update sounds" on public\.sounds for update to authenticated using \(auth\.uid\(\) = user_id\) with check \(auth\.uid\(\) = user_id\)/,
    );
    expect(sql).toMatch(
      /owner delete sounds" on public\.sounds for delete to authenticated using \(auth\.uid\(\) = user_id\)/,
    );
  });

  it("gives the admin a full-access policy", () => {
    const sql = flat(FIX);
    expect(sql).toContain("public.is_admin()");
    expect(sql).toMatch(
      /admin manage sounds" on public\.sounds for all to authenticated using \(public\.is_admin\(\)\) with check \(public\.is_admin\(\)\)/,
    );
  });

  it("adds and backfills the user_id ownership column", () => {
    const sql = flat(FIX);
    expect(sql).toContain("add column if not exists user_id uuid references public.profiles (id)");
    expect(sql).toContain("update public.sounds s set user_id = v.user_id");
  });

  it("adds the profiles.is_admin flag", () => {
    expect(flat(FIX)).toContain("add column if not exists is_admin boolean not null default false");
  });

  it("ties sounds and gifs storage writes to the caller's folder", () => {
    const sql = flat(FIX);
    for (const bucket of ["sounds", "gifs"]) {
      expect(sql).toContain(
        `bucket_id = '${bucket}' and (storage.foldername(name))[1] = auth.uid()::text`,
      );
    }
  });

  it("keeps storage readable by everyone", () => {
    expect(flat(FIX)).toMatch(
      /public read sounds bucket" on storage\.objects for select to anon, authenticated using \(bucket_id = 'sounds'\)/,
    );
  });
});

describe("sound ownership in the client", () => {
  it("stamps user_id when adding a YouTube song", () => {
    const src = readFileSync(path.join(ROOT, "src/lib/youtubeSongs.ts"), "utf8");
    expect(src).toContain("user_id: userId");
  });
});
