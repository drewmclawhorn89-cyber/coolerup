-- 20261206000000_full_security_remediation.sql
--
-- Closes the remaining Lovable security-scan findings:
--
--   Access control & authorization (3 critical)
--     1. Any signed-in user could set `profiles.is_admin = true` on their own
--        row. `public.is_admin()` reads that column, so this was a direct
--        privilege escalation into every admin-only RPC (coin credit, bans,
--        moderation). Fixed with a column-level REVOKE plus a BEFORE UPDATE
--        trigger, so restoring a table-level grant by accident cannot reopen it.
--     2. Content tables that only had a SELECT policy now get explicit
--        owner-scoped INSERT/UPDATE/DELETE policies (`auth.uid() = user_id`).
--     3. Any table still carrying an `ALL` / `true` policy is swept again.
--
--   Exposed personal & sensitive data (2 critical)
--     4. `profiles.birthday` and `profiles.venmo_handle` were world-readable.
--        Table-level SELECT is revoked and re-granted column by column, so the
--        public surface only ever contains the fields a profile card needs.
--        The owner reads their own private fields through `public.my_profile()`.
--
-- Everything is idempotent and guarded, so it is safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. Stop users from making themselves admins.
-- ---------------------------------------------------------------------------
-- Column-level privileges. `revoke update (is_admin)` only takes effect if the
-- table-level UPDATE grant is not the thing granting it, so the table-level
-- grant is rebuilt below in section 2.
do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'revoke update (is_admin) on public.profiles from anon, authenticated';
  end if;
end $$;

-- Belt and braces: even if a dashboard edit restores the grant, the trigger
-- refuses the write. `auth.uid()` is null for the service role, which must
-- still be able to set the flag.
create or replace function public.protect_profile_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_admin is distinct from old.is_admin then
    if auth.uid() is not null and not public.is_admin() then
      raise exception 'only an admin can change is_admin'
        using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.protect_profile_admin_flag() from public, anon, authenticated;

drop trigger if exists profiles_admin_flag_guard on public.profiles;
create trigger profiles_admin_flag_guard
  before update on public.profiles
  for each row
  execute function public.protect_profile_admin_flag();

-- ---------------------------------------------------------------------------
-- 2. Rebuild the profiles grant surface: public fields only.
-- ---------------------------------------------------------------------------
do $$
declare
  public_cols text;
begin
  if to_regclass('public.profiles') is null then
    return;
  end if;

  -- Every column the app renders on somebody else's profile. `birthday` and
  -- `venmo_handle` are deliberately absent.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into public_cols
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'profiles'
     and column_name in (
       'id', 'handle', 'username', 'display_name', 'bio', 'avatar_url',
       'links', 'created_at', 'onboarding_complete', 'show_liked', 'is_admin'
     );

  if public_cols is null then
    return;
  end if;

  -- A table-level grant covers every column, so it has to go first.
  execute 'revoke select on public.profiles from anon, authenticated';
  execute format('grant select (%s) on public.profiles to anon, authenticated', public_cols);

  -- Writes stay row-scoped by RLS, but the client may not touch the admin flag
  -- or the private columns it cannot read.
  execute 'revoke insert, update, delete on public.profiles from anon';
  execute 'grant insert, update on public.profiles to authenticated';
  execute 'revoke update (is_admin) on public.profiles from authenticated';
end $$;

-- The owner's own private fields. SECURITY DEFINER so it can read the columns
-- that are no longer granted, but it only ever returns the caller's row.
create or replace function public.my_profile()
returns setof public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select *
    from public.profiles
   where id = auth.uid()
$$;

revoke all on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Owner-scoped writes on the remaining content tables.
-- ---------------------------------------------------------------------------
-- Only tables whose rows belong to exactly one `user_id` are listed. Server
-- owned tables (balances, payouts, gifts, view counters, moderation) are
-- deliberately excluded: their writes go through SECURITY DEFINER functions.
do $$
declare
  t text;
  content text[] := array[
    'videos', 'comments', 'likes', 'follows', 'gifs',
    'comment_likes', 'full_videos', 'full_video_likes', 'full_video_comments',
    'full_video_comment_likes', 'story_likes', 'reposts',
    'group_posts', 'group_post_likes',
    'saved_sounds', 'saved_videos', 'saved_full_videos',
    'blocked_users', 'search_history', 'stories', 'marketplace_items',
    'live_guests', 'live_join_requests'
  ];
begin
  foreach t in array content loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);

    -- Drop anything permissive that would defeat the owner checks.
    declare
      pol record;
    begin
      for pol in
        select policyname from pg_policies
         where schemaname = 'public' and tablename = t
           and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
           and (qual is null or qual = 'true' or with_check is null or with_check = 'true')
      loop
        execute format('drop policy if exists %I on public.%I', pol.policyname, t);
      end loop;
    end;

    execute format(
      'drop policy if exists "owners insert %1$s" on public.%1$I', t);
    execute format(
      'create policy "owners insert %1$s" on public.%1$I for insert to authenticated with check (auth.uid() = user_id)', t);

    execute format(
      'drop policy if exists "owners update %1$s" on public.%1$I', t);
    execute format(
      'create policy "owners update %1$s" on public.%1$I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);

    execute format(
      'drop policy if exists "owners delete %1$s" on public.%1$I', t);
    execute format(
      'create policy "owners delete %1$s" on public.%1$I for delete to authenticated using (auth.uid() = user_id)', t);

    execute format('revoke insert, update, delete on public.%I from anon', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Final sweep: no table without RLS, no allow-all policy.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and c.relrowsecurity = false
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

do $$
declare
  pol record;
begin
  for pol in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
       and cmd = 'ALL'
       and coalesce(qual, 'true') = 'true'
       and coalesce(with_check, 'true') = 'true'
  loop
    execute format('drop policy if exists %I on public.%I', pol.policyname, pol.tablename);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Reload the PostgREST schema cache.
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
