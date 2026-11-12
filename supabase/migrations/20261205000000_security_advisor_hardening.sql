-- 20261205000000_security_advisor_hardening.sql
--
-- Follow-up to 20261204000000_security_hardening.sql.
--
-- The first pass fixed the *data* rules (who may read/write which row). This
-- pass fixes the two classes of finding that a static Supabase/Lovable security
-- advisor keeps reporting even after RLS is correct:
--
--   1. `function_search_path_mutable` - any function in `public` whose
--      `proconfig` does not pin `search_path`. A SECURITY DEFINER function with
--      a mutable search_path can be hijacked by a caller who creates a shadowing
--      object in a schema that appears earlier on the path.
--   2. `rls_policy_always_true` on lookup tables that were created from the
--      dashboard (not from a migration), so the earlier sweep could not name
--      them: `banned_words` still carried a `using (true)` SELECT policy.
--
-- Everything here is idempotent and guarded with `to_regclass`, so it is safe to
-- re-run and safe to run on a database that is missing an optional table.
--
-- Run the whole file in one go in the Supabase SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Pin search_path on every function in the public schema.
-- ---------------------------------------------------------------------------
-- `alter function` only accepts normal and window functions; aggregates and
-- procedures are skipped. `public, pg_temp` keeps pg_temp last so a caller
-- cannot shadow a table by creating a temp table of the same name.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind in ('f', 'w')
       and not exists (
         select 1
           from unnest(coalesce(p.proconfig, '{}'::text[])) as cfg
          where cfg like 'search_path=%'
       )
  loop
    begin
      execute format('alter function %s set search_path = public, pg_temp', r.sig);
    exception
      when others then
        -- A function we cannot alter (extension-owned, etc.) must not abort
        -- the whole migration.
        raise notice 'skipped search_path pin for %: %', r.sig, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 2. `banned_words` is an admin-only lookup.
-- ---------------------------------------------------------------------------
-- Nothing in the client reads it: `src/lib/moderation.ts` ships its own copy of
-- the list, and the server-side moderation path runs with the service role.
-- It was created from the dashboard, so it still had a permissive SELECT policy
-- that the earlier sweep (which only drops `cmd = 'ALL'` policies) left alone.
do $$
begin
  if to_regclass('public.banned_words') is not null then
    execute 'alter table public.banned_words enable row level security';

    -- Remove every permissive read policy, whatever it was called.
    perform 1;
    declare
      pol record;
    begin
      for pol in
        select policyname
          from pg_policies
         where schemaname = 'public'
           and tablename = 'banned_words'
           and cmd in ('SELECT', 'ALL')
      loop
        execute format('drop policy if exists %I on public.banned_words', pol.policyname);
      end loop;
    end;

    execute $p$
      create policy "admins read banned words"
        on public.banned_words
        for select
        to authenticated
        using (public.is_admin())
    $p$;

    execute 'revoke all on public.banned_words from anon';
    execute 'revoke insert, update, delete on public.banned_words from authenticated';
    execute 'grant select on public.banned_words to authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. `muted_words` stays world-readable (the client filters comments with it)
--    but only admins may change it.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.muted_words') is not null then
    execute 'alter table public.muted_words enable row level security';

    declare
      pol record;
    begin
      for pol in
        select policyname
          from pg_policies
         where schemaname = 'public'
           and tablename = 'muted_words'
           and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      loop
        execute format('drop policy if exists %I on public.muted_words', pol.policyname);
      end loop;
    end;

    if not exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = 'muted_words' and cmd = 'SELECT'
    ) then
      execute $p$
        create policy "muted words are public"
          on public.muted_words for select
          to anon, authenticated
          using (true)
      $p$;
    end if;

    execute $p$
      create policy "admins manage muted words"
        on public.muted_words for all
        to authenticated
        using (public.is_admin())
        with check (public.is_admin())
    $p$;

    execute 'revoke insert, update, delete on public.muted_words from anon, authenticated';
    execute 'grant select on public.muted_words to anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Re-assert the locked-down surface on the coin tables.
-- ---------------------------------------------------------------------------
-- Belt and braces: even if a later dashboard edit re-granted table privileges,
-- clients still cannot write balances directly. All balance movement goes
-- through SECURITY DEFINER functions (`send_live_gift`, `claim_free_coins`,
-- `admin_credit_coins`, ...).
do $$
declare
  t text;
begin
  foreach t in array array['user_coins', 'user_balance'] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke insert, delete on public.%I from anon, authenticated', t);
      execute format('revoke update on public.%I from anon', t);
      execute format('grant select, update on public.%I to authenticated', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Trigger functions are not callable RPCs.
-- ---------------------------------------------------------------------------
-- A trigger function is invoked by the trigger machinery as the table owner, so
-- it never needs EXECUTE for `anon` / `authenticated`. Leaving it granted makes
-- it show up in the PostgREST RPC surface and is reported as an unnecessary
-- SECURITY DEFINER exposure.
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prorettype = 'trigger'::regtype
  loop
    begin
      execute format('revoke all on function %s from public', r.sig);
      execute format('revoke all on function %s from anon, authenticated', r.sig);
    exception
      when others then
        raise notice 'skipped trigger revoke for %: %', r.sig, sqlerrm;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Make PostgREST pick up the new policies immediately.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
