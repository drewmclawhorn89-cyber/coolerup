-- 0015_ban_enforcement.sql
-- Enforce bans at the database level so a banned account cannot read or write
-- any app data, regardless of which screen they navigate to.
--
-- Before this migration the only ban check lived in the client (home route only),
-- so a banned user could still browse /u/<name>, /settings, etc., and could still
-- hit the API directly. Everything below is idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Helper functions
-- ---------------------------------------------------------------------------

-- Is the given auth user currently banned? Resolves the account's handle from
-- public.profiles and checks public.banned_users. SECURITY DEFINER so it works
-- even though banned_users is admin-write-only and profiles may be restricted.
create or replace function public.is_banned_uid(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.banned_users b on b.username = p.handle
    where p.id = _uid
      and (b.is_permanent or b.expires_at is null or b.expires_at > now())
  )
$$;

grant execute on function public.is_banned_uid(uuid) to anon, authenticated, service_role;

-- Handle-based variant (same semantics as the original public.is_banned, but
-- explicit about the "expires_at is null => permanent" case).
create or replace function public.is_banned_username(_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.banned_users
    where username = _username
      and (is_permanent or expires_at is null or expires_at > now())
  )
$$;

grant execute on function public.is_banned_username(text) to anon, authenticated, service_role;

-- Single call the client uses to render the "you are banned" screen.
create or replace function public.my_ban_status()
returns table (
  is_banned boolean,
  reason text,
  is_permanent boolean,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    true as is_banned,
    b.reason,
    b.is_permanent,
    b.expires_at
  from public.profiles p
  join public.banned_users b on b.username = p.handle
  where p.id = auth.uid()
    and (b.is_permanent or b.expires_at is null or b.expires_at > now())
  limit 1
$$;

grant execute on function public.my_ban_status() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Restrictive policies on content tables
--    RESTRICTIVE policies are AND-ed with the existing permissive policies, so
--    this removes access for banned accounts without touching existing rules.
-- ---------------------------------------------------------------------------

do $$
declare
  t text;
  tables text[] := array[
    'videos',
    'comments',
    'likes',
    'follows',
    'messages',
    'direct_messages',
    'notifications',
    'saved_videos',
    'reposts',
    'stories',
    'story_likes',
    'blocked_users',
    'muted_words',
    'reports',
    'push_subscriptions',
    'marketplace_items'
  ];
begin
  foreach t in array tables loop
    -- Skip tables that don't exist in this project yet.
    if to_regclass('public.' || t) is null then
      continue;
    end if;

    execute format('drop policy if exists %I on public.%I', 'banned users blocked', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      'using (not public.is_banned_uid(auth.uid())) '
      'with check (not public.is_banned_uid(auth.uid()))',
      'banned users blocked', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Profiles: banned accounts may still SELECT their own row (so the ban
--    screen can show their handle) but cannot write.
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.profiles') is not null then
    drop policy if exists "banned users cannot insert profile" on public.profiles;
    create policy "banned users cannot insert profile" on public.profiles
      as restrictive for insert to authenticated
      with check (not public.is_banned_uid(auth.uid()));

    drop policy if exists "banned users cannot update profile" on public.profiles;
    create policy "banned users cannot update profile" on public.profiles
      as restrictive for update to authenticated
      using (not public.is_banned_uid(auth.uid()))
      with check (not public.is_banned_uid(auth.uid()));

    drop policy if exists "banned users cannot delete profile" on public.profiles;
    create policy "banned users cannot delete profile" on public.profiles
      as restrictive for delete to authenticated
      using (not public.is_banned_uid(auth.uid()));
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Refresh PostgREST's schema cache so the new RPCs are callable immediately.
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
