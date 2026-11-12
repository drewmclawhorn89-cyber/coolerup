-- 20261207000000_close_remaining_findings.sql
--
-- Second pass over the Lovable security review. The first pass
-- (20261206000000) closed the admin-escalation and profiles-PII findings.
-- This one closes what a live probe of the deployed project still showed:
--
--   * `muted_words` was readable by `anon`. The word filter only ever runs
--     inside a signed-in session, so the list does not need to be public.
--   * `live_gifts` was readable by `anon`, exposing sender/receiver ids and
--     gift amounts to anyone with the publishable key.
--   * Any table that was not explicitly meant to be public still carried a
--     SELECT grant to `anon`. Rather than chase them one by one, this
--     migration revokes `anon` SELECT on everything outside an allowlist of
--     genuinely public content tables.
--   * `anon` could EXECUTE every function in `public`. No anonymous visitor
--     needs to call an RPC, so that grant goes away too.
--   * `pgcrypto` / `uuid-ossp` were installed in the `public` schema, which
--     the Supabase advisor reports as `extension_in_public`.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Word filters: signed-in readers only.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.muted_words') is not null then
    execute 'revoke select on public.muted_words from anon';
    execute 'grant select on public.muted_words to authenticated';
  end if;

  if to_regclass('public.banned_words') is not null then
    execute 'revoke all on public.banned_words from anon';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Live gifts: participants only, never anonymous.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.live_gifts') is not null then
    execute 'revoke select on public.live_gifts from anon';
    execute 'grant select on public.live_gifts to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Revoke anonymous SELECT on everything that is not public content.
-- ---------------------------------------------------------------------------
-- This is the systematic version of the finding: a table-level grant to `anon`
-- means PostgREST will answer `200 []` for it, and a single missing policy is
-- all that stands between that and a full dump. Only the tables a logged-out
-- visitor actually renders are left readable.
do $$
declare
  public_tables text[] := array[
    'profiles',            -- column-scoped grant from 20261206000000
    'sounds',
    'videos',
    'full_videos',
    'comments',
    'likes',
    'follows',
    'gifs',
    'comment_likes',
    'full_video_likes',
    'full_video_comments',
    'full_video_comment_likes',
    'story_likes',
    'reposts',
    'live_guests',
    'groups',
    'group_posts',
    'group_members',
    'gta6_badges',
    'beta_features',
    'video_views'
  ];
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relname <> all (public_tables)
  loop
    begin
      execute format('revoke select on public.%I from anon', r.relname);
    exception when others then
      raise notice 'skip revoke select on %: %', r.relname, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Anonymous visitors do not call RPCs.
-- ---------------------------------------------------------------------------
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype <> 'trigger'::regtype
  loop
    begin
      execute format('revoke execute on function %s from anon', f.sig);
    exception when others then
      raise notice 'skip revoke execute on %: %', f.sig, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Move extensions out of the public schema.
-- ---------------------------------------------------------------------------
-- `extension_in_public` is an advisor warning: anything in `public` is
-- reachable through PostgREST. Moving the extensions keeps their functions
-- available (they are resolved by name) while removing them from the API
-- surface. Guarded because a self-hosted database may already have done this.
do $$
begin
  if not exists (select 1 from pg_namespace where nspname = 'extensions') then
    execute 'create schema extensions';
  end if;
end $$;

do $$
declare
  e record;
begin
  for e in
    select extname
      from pg_extension
     where extname in ('pgcrypto', 'uuid-ossp', 'pg_net', 'pg_stat_statements')
       and extnamespace = 'public'::regnamespace
  loop
    begin
      execute format('alter extension %I set schema extensions', e.extname);
    exception when others then
      raise notice 'could not move extension %: %', e.extname, sqlerrm;
    end;
  end loop;
end $$;

-- Keep the moved helpers resolvable for anything still calling them unqualified.
do $$
begin
  execute 'grant usage on schema extensions to anon, authenticated, service_role';
exception when others then
  raise notice 'skip grant usage on extensions: %', sqlerrm;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
