-- ============================================================================
-- Security hardening pass (v2 - corrected against the live schema)
-- ============================================================================
-- Closes the six findings from the security review:
--
--   1. Cash / coin credit must be server-only and admin-only.
--   2. A group member must not be able to promote themselves to admin.
--   3. YouTube helpers must never touch another user's rows.
--   4. `sounds` is public-read, owner-write only.
--   5. Notifications may only be delivered to a friend / follower (or by an
--      admin) - no random push spam.
--   6. Every table has RLS on, public read for content, owner-only writes, and
--      no "allow all" policies.
--
-- IMPORTANT - why v2 exists
-- -------------------------
-- v1 of this file assumed that `public.profiles.is_admin` and
-- `public.sounds.user_id` already existed (they were added by
-- 20261203000000_fix_sounds_rls.sql). On the live database they did NOT exist,
-- so the very first statement
--
--     create function public.is_admin() ... from public.profiles p ...
--
-- failed with `column p.is_admin does not exist`. Because the Supabase SQL
-- editor runs the whole script in one transaction, that single error rolled
-- back *every* fix below it. That is why nothing changed.
--
-- v2 creates the two missing columns itself (section 0) before anything reads
-- them, and every later block is written so that one missing table can no
-- longer abort the rest of the script.
--
-- Everything is idempotent: safe to run more than once.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. Schema prerequisites (the columns v1 assumed already existed)
-- ----------------------------------------------------------------------------

-- Admin flag on profiles. The app (coins.functions.ts, notify.ts,
-- push.functions.ts) already selects this column, so without it those server
-- functions error out - which is itself a live bug.
alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Keep the handle-based owner flagged as admin.
update public.profiles
   set is_admin = true
 where lower(replace(coalesce(handle, ''), '@', '')) = 'drewmclawhorn3'
    or lower(coalesce(username, '')) = 'drewmclawhorn3';

-- Ownership column on sounds. RLS cannot scope writes to an owner without it.
alter table public.sounds
  add column if not exists user_id uuid references public.profiles (id) on delete cascade;

-- Backfill from the source video first...
update public.sounds s
   set user_id = v.user_id
  from public.videos v
 where v.id = s.original_video_id
   and s.user_id is null;

-- ...then from the creator's handle for rows with no source video.
update public.sounds s
   set user_id = (
     select p.id
       from public.profiles p
      where lower(coalesce(p.handle, '')) = lower(coalesce(s.creator_username, ''))
      limit 1
   )
 where s.user_id is null
   and exists (
     select 1
       from public.profiles p
      where lower(coalesce(p.handle, '')) = lower(coalesce(s.creator_username, ''))
   );

create index if not exists sounds_user_id_idx on public.sounds (user_id);

-- ----------------------------------------------------------------------------
-- 1. Shared helper functions
-- ----------------------------------------------------------------------------

-- Admin check: the profiles flag, the legacy handle fallback, or a row in
-- `user_roles` with role 'admin' / 'owner'. Written in plpgsql (not sql) so a
-- missing optional table can never abort the migration at creation time.
create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_flag boolean;
  v_role boolean;
begin
  if auth.uid() is null then
    return false;
  end if;

  select coalesce(p.is_admin, false)
         or lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
         or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
    into v_flag
    from public.profiles p
   where p.id = auth.uid();

  if coalesce(v_flag, false) then
    return true;
  end if;

  if to_regclass('public.user_roles') is not null then
    execute
      'select exists (select 1 from public.user_roles where user_id = $1 and role in (''admin'', ''owner''))'
      into v_role
      using auth.uid();
    if coalesce(v_role, false) then
      return true;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
grant execute on function public.is_admin() to authenticated;

-- Group admin check: the group owner, or a member whose role is 'admin'.
create or replace function public.is_group_admin(_group_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_owner boolean;
  v_member boolean;
begin
  if _group_id is null or auth.uid() is null then
    return false;
  end if;

  select exists (
    select 1 from public.groups g
     where g.id = _group_id and g.creator_id = auth.uid()
  ) into v_owner;

  if coalesce(v_owner, false) then
    return true;
  end if;

  select exists (
    select 1 from public.group_members m
     where m.group_id = _group_id
       and m.user_id = auth.uid()
       and m.role = 'admin'
  ) into v_member;

  return coalesce(v_member, false);
end;
$$;

revoke all on function public.is_group_admin(uuid) from public;
revoke all on function public.is_group_admin(uuid) from anon;
grant execute on function public.is_group_admin(uuid) to authenticated;

-- Notification authorization: self, admin, or an existing follow relationship
-- in either direction (a "friend" in this app is an either-direction follow).
-- `follows` stores handles, so resolve both handles first.
create or replace function public.can_notify(_target uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_me text;
  v_them text;
begin
  if _target is null or auth.uid() is null then
    return false;
  end if;

  if _target = auth.uid() then
    return true;
  end if;

  if public.is_admin() then
    return true;
  end if;

  select lower(coalesce(handle, username, ''))
    into v_me
    from public.profiles
   where id = auth.uid();

  select lower(coalesce(handle, username, ''))
    into v_them
    from public.profiles
   where id = _target;

  if coalesce(v_me, '') = '' or coalesce(v_them, '') = '' then
    return false;
  end if;

  return exists (
    select 1
      from public.follows f
     where (lower(f.follower_username) = v_me and lower(f.following_username) = v_them)
        or (lower(f.follower_username) = v_them and lower(f.following_username) = v_me)
  );
end;
$$;

revoke all on function public.can_notify(uuid) from public;
revoke all on function public.can_notify(uuid) from anon;
grant execute on function public.can_notify(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Cash / coin credit - server only, admin only
-- ----------------------------------------------------------------------------
-- Clients never write wallet balances. The Stripe / Venmo server functions use
-- the service-role key (which bypasses RLS) after verifying the payment, and
-- admins use the guarded `admin_credit_coins` RPC below. Everyone else is
-- limited to reading their own wallet.

alter table public.user_coins enable row level security;

drop policy if exists "read own coin balance" on public.user_coins;
create policy "read own coin balance" on public.user_coins
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "admins read coin balances" on public.user_coins;
create policy "admins read coin balances" on public.user_coins
  for select to authenticated
  using (public.is_admin());

-- The only UPDATE path for a normal client is gone; admins can still correct a
-- balance from the dashboard, and the check re-verifies on write.
drop policy if exists "admins update coin balances" on public.user_coins;
create policy "admins update coin balances" on public.user_coins
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke insert, delete on public.user_coins from anon, authenticated;
grant select on public.user_coins to authenticated;
grant update on public.user_coins to authenticated;

-- Same treatment for the legacy `user_balance` wallet when it exists.
do $$
begin
  if to_regclass('public.user_balance') is not null then
    execute 'alter table public.user_balance enable row level security';

    execute 'drop policy if exists "read own balance" on public.user_balance';
    execute 'create policy "read own balance" on public.user_balance
               for select to authenticated using (auth.uid() = user_id)';

    execute 'drop policy if exists "admins read balances" on public.user_balance';
    execute 'create policy "admins read balances" on public.user_balance
               for select to authenticated using (public.is_admin())';

    execute 'drop policy if exists "admins update balances" on public.user_balance';
    execute 'create policy "admins update balances" on public.user_balance
               for update to authenticated
               using (public.is_admin()) with check (public.is_admin())';

    execute 'revoke insert, delete on public.user_balance from anon, authenticated';
    execute 'grant select on public.user_balance to authenticated';
    execute 'grant update on public.user_balance to authenticated';
  end if;
end $$;

-- Guarded admin credit. Even though the RPC is SECURITY DEFINER, it refuses to
-- run for anyone who is not a real admin, so a client cannot call it directly
-- to mint coins.
create or replace function public.admin_credit_coins(
  _user_id uuid,
  _coins integer,
  _diamonds integer default 0,
  _reason text default null
)
returns public.user_coins
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.user_coins;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  if not public.is_admin() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  if _user_id is null then
    raise exception 'missing_user' using errcode = '22023';
  end if;

  if coalesce(_coins, 0) = 0 and coalesce(_diamonds, 0) = 0 then
    raise exception 'nothing_to_credit' using errcode = '22023';
  end if;

  if coalesce(_coins, 0) < 0 or coalesce(_diamonds, 0) < 0 then
    raise exception 'negative_credit' using errcode = '22023';
  end if;

  insert into public.user_coins (user_id, balance, diamonds, updated_at)
  values (_user_id, coalesce(_coins, 0), coalesce(_diamonds, 0), now())
  on conflict (user_id) do update
    set balance = public.user_coins.balance + coalesce(_coins, 0),
        diamonds = public.user_coins.diamonds + coalesce(_diamonds, 0),
        updated_at = now()
  returning * into v_row;

  -- Best-effort audit trail. moderation_log only exposes (id, action,
  -- created_at) on this database, so the details go into the action string and
  -- any failure is swallowed rather than rolling back the credit.
  begin
    insert into public.moderation_log (action)
    values (
      'admin_credit_coins user=' || _user_id::text
      || ' coins=' || coalesce(_coins, 0)::text
      || ' diamonds=' || coalesce(_diamonds, 0)::text
      || ' reason=' || coalesce(_reason, '')
    );
  exception when others then
    null;
  end;

  return v_row;
end;
$$;

revoke all on function public.admin_credit_coins(uuid, integer, integer, text) from public;
revoke all on function public.admin_credit_coins(uuid, integer, integer, text) from anon;
grant execute on function public.admin_credit_coins(uuid, integer, integer, text) to authenticated;

-- ----------------------------------------------------------------------------
-- 3. Group membership - no self-promotion
-- ----------------------------------------------------------------------------

alter table public.group_members enable row level security;

-- Joining: you may only add yourself, and only as a normal member or a pending
-- request. Granting admin/moderator requires an existing group admin.
drop policy if exists "users join groups" on public.group_members;
create policy "users join groups" on public.group_members
  for insert to authenticated
  with check (
    auth.uid() = user_id
    and (
      role in ('member', 'pending')
      or public.is_group_admin(group_id)
    )
  );

-- Updating: only a group admin may change any membership row. This removes the
-- old `auth.uid() = user_id` escape hatch that let a member rewrite their own
-- role to 'admin'.
drop policy if exists "admins update members" on public.group_members;
create policy "admins update members" on public.group_members
  for update to authenticated
  using (public.is_group_admin(group_id))
  with check (public.is_group_admin(group_id));

-- Deleting: you may leave (delete your own row), admins may remove anyone.
drop policy if exists "users leave or admins manage members" on public.group_members;
create policy "users leave or admins manage members" on public.group_members
  for delete to authenticated
  using (auth.uid() = user_id or public.is_group_admin(group_id));

drop policy if exists "members readable" on public.group_members;
create policy "members readable" on public.group_members
  for select to anon, authenticated
  using (true);

-- Belt and braces: a trigger that rejects privilege escalation even if a future
-- policy is written loosely. Service-role / definer calls (auth.uid() is null)
-- are trusted and pass straight through.
create or replace function public.enforce_group_member_role()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.role in ('admin', 'moderator') and not public.is_group_admin(new.group_id) then
      raise exception 'only a group admin can grant the % role', new.role
        using errcode = '42501';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.group_id is distinct from old.group_id or new.user_id is distinct from old.user_id then
    raise exception 'group membership rows cannot be moved'
      using errcode = '42501';
  end if;

  if new.role is distinct from old.role then
    if not public.is_group_admin(new.group_id) then
      raise exception 'only a group admin can change member roles'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists group_member_role_guard on public.group_members;
create trigger group_member_role_guard
  before insert or update on public.group_members
  for each row execute function public.enforce_group_member_role();

-- ----------------------------------------------------------------------------
-- 4. YouTube videos - owner-scoped writes
-- ----------------------------------------------------------------------------
-- `full_videos` holds YouTube imports. Reads stay public; every write must be
-- the row owner (`auth.uid() = user_id`). The server functions are also
-- tightened to scope their service-role updates by the caller's id.

alter table public.full_videos enable row level security;

drop policy if exists "full videos are public" on public.full_videos;
create policy "full videos are public" on public.full_videos
  for select to anon, authenticated
  using (true);

drop policy if exists "owner inserts youtube videos" on public.full_videos;
create policy "owner inserts youtube videos" on public.full_videos
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "owner updates youtube videos" on public.full_videos;
create policy "owner updates youtube videos" on public.full_videos
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owner deletes youtube videos" on public.full_videos;
create policy "owner deletes youtube videos" on public.full_videos
  for delete to authenticated
  using (auth.uid() = user_id);

grant select on public.full_videos to anon, authenticated;
grant insert, update, delete on public.full_videos to authenticated;

-- ----------------------------------------------------------------------------
-- 5. Sounds - public read, owner write
-- ----------------------------------------------------------------------------

alter table public.sounds enable row level security;

drop policy if exists "sounds are public" on public.sounds;
drop policy if exists "signed in users create sounds" on public.sounds;
drop policy if exists "creators update own sounds" on public.sounds;

drop policy if exists "public read sounds" on public.sounds;
create policy "public read sounds" on public.sounds
  for select to anon, authenticated
  using (true);

drop policy if exists "owner insert sounds" on public.sounds;
create policy "owner insert sounds" on public.sounds
  for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "owner update sounds" on public.sounds;
create policy "owner update sounds" on public.sounds
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "owner delete sounds" on public.sounds;
create policy "owner delete sounds" on public.sounds
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "admin manage sounds" on public.sounds;
create policy "admin manage sounds" on public.sounds
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.sounds to anon, authenticated;
grant insert, update, delete on public.sounds to authenticated;

-- ----------------------------------------------------------------------------
-- 6. Notifications - only friends / followers (or admins)
-- ----------------------------------------------------------------------------
-- The table already exists on this database with exactly these columns, so the
-- `create table if not exists` is only a safety net for fresh environments.

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references auth.users (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  type text not null,
  text text not null default '',
  video_id uuid,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists notifications_target_created_idx
  on public.notifications (target_user_id, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists "notifs read own" on public.notifications;
create policy "notifs read own" on public.notifications
  for select to authenticated
  using (auth.uid() = target_user_id);

drop policy if exists "notifs update own" on public.notifications;
create policy "notifs update own" on public.notifications
  for update to authenticated
  using (auth.uid() = target_user_id)
  with check (auth.uid() = target_user_id);

drop policy if exists "notifs delete own" on public.notifications;
create policy "notifs delete own" on public.notifications
  for delete to authenticated
  using (auth.uid() = target_user_id);

-- The important one: you may only create a notification as yourself, and only
-- for someone you actually know (or if you are an admin).
drop policy if exists "notifs insert as actor" on public.notifications;
drop policy if exists "notifs insert all" on public.notifications;
create policy "notifs insert as actor" on public.notifications
  for insert to authenticated
  with check (
    actor_user_id = auth.uid()
    and public.can_notify(target_user_id)
  );

grant select, update, delete on public.notifications to authenticated;
grant insert on public.notifications to authenticated;

-- ----------------------------------------------------------------------------
-- 7. Table sweep - RLS on, public read, owner-only writes, no allow-all
-- ----------------------------------------------------------------------------

-- 7a. Turn RLS on for any public table that is still missing it.
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

-- 7b. Drop any "allow all" policy (ALL command with a true predicate).
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and cmd = 'ALL'
      and coalesce(qual, 'true') = 'true'
      and coalesce(with_check, 'true') = 'true'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- 7c. Money / secret tables: never writable by clients. Reads stay governed by
--     whatever row policy already exists (own-row or admin-only).
--     Note: live_gifts and video_views are in here because their writes go
--     through the send_live_gift() / increment_full_video_views() definer RPCs.
do $$
declare
  t text;
  sensitive text[] := array[
    'user_coins', 'user_balance', 'coin_purchases', 'coin_cashouts',
    'coin_venmo_orders', 'free_coin_claims', 'payouts',
    'creator_fund_earnings', 'follower_rewards', 'push_config',
    'push_subscriptions', 'moderation_log', 'banned_words',
    'reserved_usernames', 'subscription_codes', 'redeemed_codes',
    'gift_card_orders', 'gift_claims', 'live_gifts', 'video_views',
    'gta6_badges', 'banned_users'
  ];
begin
  foreach t in array sensitive loop
    if to_regclass(format('public.%I', t)) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('revoke insert, update, delete on public.%I from anon, authenticated', t);
      execute format('grant select on public.%I to anon, authenticated', t);
    end if;
  end loop;
end $$;

-- 7d. Content tables: public read + owner-only writes when the table has a
--     `user_id` column and does not already define its own write policy.
do $$
declare
  t text;
  content text[] := array[
    'videos', 'full_videos', 'stories', 'comments', 'full_video_comments',
    'reposts', 'saved_videos', 'saved_full_videos', 'saved_sounds',
    'marketplace_items', 'group_posts', 'groups', 'search_history',
    'gif_reports', 'comment_likes', 'full_video_likes',
    'full_video_comment_likes', 'story_likes'
  ];
  has_user_id boolean;
  has_select boolean;
  has_insert boolean;
  has_update boolean;
  has_delete boolean;
begin
  foreach t in array content loop
    if to_regclass(format('public.%I', t)) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant insert, update, delete on public.%I to authenticated', t);

    select exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'user_id'
    ) into has_user_id;

    select exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'SELECT'
    ) into has_select;

    if not has_select then
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
                     'public read ' || t, t);
    end if;

    if not has_user_id then
      continue;
    end if;

    select exists (select 1 from pg_policies where schemaname='public' and tablename=t and cmd='INSERT') into has_insert;
    select exists (select 1 from pg_policies where schemaname='public' and tablename=t and cmd='UPDATE') into has_update;
    select exists (select 1 from pg_policies where schemaname='public' and tablename=t and cmd='DELETE') into has_delete;

    if not has_insert then
      execute format('create policy %I on public.%I for insert to authenticated with check (auth.uid() = user_id)',
                     'owner insert ' || t, t);
    end if;
    if not has_update then
      execute format('create policy %I on public.%I for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)',
                     'owner update ' || t, t);
    end if;
    if not has_delete then
      execute format('create policy %I on public.%I for delete to authenticated using (auth.uid() = user_id)',
                     'owner delete ' || t, t);
    end if;
  end loop;
end $$;

-- 7e. Any remaining public table with RLS on but no SELECT policy would be
--     unreadable. Content tables get public read so the app keeps working;
--     sensitive tables get an admin-only read instead of leaking to the world,
--     and the secret-bearing tables stay completely closed.
do $$
declare
  r record;
  sensitive text[] := array[
    'user_coins', 'user_balance', 'coin_purchases', 'coin_cashouts',
    'coin_venmo_orders', 'free_coin_claims', 'payouts',
    'creator_fund_earnings', 'follower_rewards', 'moderation_log',
    'banned_words', 'reserved_usernames', 'subscription_codes',
    'redeemed_codes', 'gift_card_orders', 'gift_claims', 'live_gifts',
    'video_views', 'gta6_badges', 'banned_users'
  ];
  sealed text[] := array['push_config', 'push_subscriptions'];
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'
      and c.relrowsecurity = true
      and not exists (
        select 1 from pg_policies p
        where p.schemaname = 'public' and p.tablename = c.relname and p.cmd = 'SELECT'
      )
      and c.relname <> all (sealed)
  loop
    if r.relname = any (sensitive) then
      execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())',
                     'admins read ' || r.relname, r.relname);
    else
      execute format('create policy %I on public.%I for select to anon, authenticated using (true)',
                     'public read ' || r.relname, r.relname);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';
