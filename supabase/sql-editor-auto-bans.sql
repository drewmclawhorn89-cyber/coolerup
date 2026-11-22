-- ============================================================================
-- Coolerup · Auto Bans (3-strike ladder + instant ban for sexual content)
-- ============================================================================
-- Adds the missing half of moderation: the escalation ladder.
--
--   sexual content -> PERMANENT BAN on the first offence (no ladder)
--   strike 1  -> warning popup + the offending post/comment is removed
--   strike 2  -> warning popup + removal + 24 hour mute (no post, no comment)
--   strike 3  -> warning popup + PERMANENT BAN
--
-- A permanent ban also burns the account's email, phone and every device it
-- was ever seen on, so a fresh account cannot be created from the same
-- hardware. `check_identity_ban()` is what the signup screen calls.
--
-- Everything here is additive. Nothing in the existing moderation schema is
-- dropped or rewritten, so `admin_ban`, `admin_unban`, `report_content` and
-- the current /admin screen keep working exactly as before.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Strike counter
-- ---------------------------------------------------------------------------
create table if not exists public.user_strikes (
  user_id uuid primary key,
  username text not null,
  strike_count integer not null default 0 check (strike_count >= 0),
  last_reason text,
  last_kind text,
  last_content_type text,
  last_content_id uuid,
  muted_until timestamptz,
  banned_at timestamptz,
  is_permanent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_strikes_username_idx on public.user_strikes (lower(username));
create index if not exists user_strikes_muted_idx on public.user_strikes (muted_until)
  where muted_until is not null;

alter table public.user_strikes enable row level security;

drop policy if exists "user can read own strikes" on public.user_strikes;
create policy "user can read own strikes" on public.user_strikes
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "admins read all strikes" on public.user_strikes;
create policy "admins read all strikes" on public.user_strikes
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.user_strikes to authenticated;
grant all on public.user_strikes to service_role;

-- ---------------------------------------------------------------------------
-- 2. Devices a user has signed in from
-- ---------------------------------------------------------------------------
create table if not exists public.user_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  device_id text not null,
  created_at timestamptz not null default now(),
  last_seen timestamptz not null default now(),
  unique (user_id, device_id)
);

create index if not exists user_devices_user_idx on public.user_devices (user_id);

alter table public.user_devices enable row level security;

drop policy if exists "user reads own devices" on public.user_devices;
create policy "user reads own devices" on public.user_devices
  for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "admins read all devices" on public.user_devices;
create policy "admins read all devices" on public.user_devices
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.user_devices to authenticated;
grant all on public.user_devices to service_role;

-- ---------------------------------------------------------------------------
-- 3. Banned identities (device / email / phone)
-- ---------------------------------------------------------------------------
create table if not exists public.identity_bans (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('device', 'email', 'phone')),
  value_hash text not null,
  value_hint text,
  reason text,
  banned_user_id uuid,
  banned_username text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (kind, value_hash)
);

create index if not exists identity_bans_lookup_idx on public.identity_bans (kind, value_hash)
  where active;

alter table public.identity_bans enable row level security;

drop policy if exists "admins read identity bans" on public.identity_bans;
create policy "admins read identity bans" on public.identity_bans
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.identity_bans to authenticated;
grant all on public.identity_bans to service_role;

-- ---------------------------------------------------------------------------
-- 4. Helpers
-- ---------------------------------------------------------------------------

-- Hash an identity value so the raw email / phone / device id never sits in
-- the table in plain text.
create or replace function public.identity_hash(_value text)
returns text
language sql
immutable
as $$
  select md5(lower(btrim(coalesce(_value, ''))));
$$;

-- "Is this the owner account?" — the only account allowed to unban.
create or replace function public.is_owner()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and lower(btrim(coalesce(p.handle, ''))) = 'drewmclawhorn3'
  );
$$;

grant execute on function public.is_owner() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Register the device the app is running on
-- ---------------------------------------------------------------------------
create or replace function public.register_device(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if p_device_id is null or length(btrim(p_device_id)) < 8 then
    return jsonb_build_object('ok', false, 'error', 'bad_device_id');
  end if;

  insert into public.user_devices (user_id, device_id)
  values (uid, btrim(p_device_id))
  on conflict (user_id, device_id) do update set last_seen = now();

  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function public.register_device(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Signup gate: is this device / email / phone banned?
-- ---------------------------------------------------------------------------
create or replace function public.check_identity_ban(p_kind text, p_value text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hit public.identity_bans%rowtype;
begin
  if p_kind not in ('device', 'email', 'phone') then
    return jsonb_build_object('banned', false);
  end if;
  if p_value is null or length(btrim(p_value)) = 0 then
    return jsonb_build_object('banned', false);
  end if;

  select * into hit
  from public.identity_bans
  where kind = p_kind
    and value_hash = public.identity_hash(p_value)
    and active
  limit 1;

  if hit.id is null then
    return jsonb_build_object('banned', false);
  end if;

  return jsonb_build_object(
    'banned', true,
    'kind', hit.kind,
    'reason', hit.reason,
    'message', 'This device is banned from Coolerup'
  );
end;
$$;

grant execute on function public.check_identity_ban(text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Burn an identity (internal)
-- ---------------------------------------------------------------------------
create or replace function public.ban_identity(
  p_kind text,
  p_value text,
  p_reason text,
  p_user_id uuid,
  p_username text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_value is null or length(btrim(p_value)) = 0 then
    return;
  end if;
  if p_kind not in ('device', 'email', 'phone') then
    return;
  end if;

  insert into public.identity_bans (kind, value_hash, value_hint, reason, banned_user_id, banned_username)
  values (
    p_kind,
    public.identity_hash(p_value),
    -- A short, non-reversible hint so an admin can tell two entries apart.
    left(regexp_replace(p_value, '^(.{0,2}).*(.{0,2})$', '\1***\2'), 24),
    p_reason,
    p_user_id,
    p_username
  )
  on conflict (kind, value_hash) do update
    set active = true,
        reason = excluded.reason,
        banned_user_id = excluded.banned_user_id,
        banned_username = excluded.banned_username;
end;
$$;

revoke all on function public.ban_identity(text, text, text, uuid, text) from public;
grant execute on function public.ban_identity(text, text, text, uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- 8. The ladder
-- ---------------------------------------------------------------------------
create or replace function public.auto_moderate(
  p_user_id uuid,
  p_username text,
  p_kind text,                 -- sexual | bullying | threat | spam | other
  p_reason text,
  p_content_type text default null,   -- video | comment | profile_pic | none
  p_content_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  row_strike public.user_strikes%rowtype;
  new_count integer;
  action text;
  muted timestamptz;
  permanent boolean := false;
  deleted boolean := false;
  message text;
  target_email text;
  target_phone text;
  dev record;
begin
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_user');
  end if;

  -- A signed-in client may only moderate itself. Without this an authenticated
  -- user could pass someone else's uuid and stack strikes on their account.
  -- service_role (auth.uid() is null) and admins are exempt.
  if auth.uid() is not null
     and p_user_id <> auth.uid()
     and not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  -- Never auto-ban an admin. Moderation should not be able to take out the
  -- people who run the app.
  if public.has_role(p_user_id, 'admin') then
    return jsonb_build_object('ok', false, 'error', 'target_is_admin', 'strike', 0);
  end if;

  select * into row_strike from public.user_strikes where user_id = p_user_id;

  -- Already permanently banned: report it, do not keep counting.
  if row_strike.is_permanent then
    return jsonb_build_object(
      'ok', true,
      'strike', 3,
      'action', 'banned',
      'permanent', true,
      'message', 'Your account is permanently banned',
      'deleted', false
    );
  end if;

  -- Explicit sexual content is an instant permanent ban: no ladder, no second
  -- chance, no 24h mute. Bullying / threats / spam still climb 1 -> 2 -> 3.
  if p_kind = 'sexual' then
    new_count := 3;
  else
    new_count := coalesce(row_strike.strike_count, 0) + 1;
    if new_count > 3 then new_count := 3; end if;
  end if;

  -- Remove the offending content on every strike.
  if p_content_id is not null then
    if p_content_type = 'comment' then
      begin
        delete from public.comments where id = p_content_id;
        deleted := true;
      exception when others then
        begin
          update public.comments set body = '[removed by Coolerup]' where id = p_content_id;
          deleted := true;
        exception when others then
          deleted := false;
        end;
      end;
    elsif p_content_type = 'video' then
      begin
        delete from public.videos where id = p_content_id;
        deleted := true;
      exception when others then
        begin
          update public.videos set hidden = true, hidden_reason = p_reason where id = p_content_id;
          deleted := true;
        exception when others then
          deleted := false;
        end;
      end;
    end if;
  end if;

  if new_count = 1 then
    action := 'warn';
    message := 'Warning 1/3 — This breaks Coolerup rules';
  elsif new_count = 2 then
    action := 'mute';
    muted := now() + interval '24 hours';
    message := 'Warning 2/3 — This breaks Coolerup rules. You are muted for 24 hours.';
  else
    action := 'ban';
    permanent := true;
    if p_kind = 'sexual' then
      message := 'Your account is permanently banned — explicit sexual content is not allowed on Coolerup.';
    else
      message := 'Warning 3/3 — This breaks Coolerup rules. Your account is permanently banned.';
    end if;
  end if;

  insert into public.user_strikes as us (
    user_id, username, strike_count, last_reason, last_kind,
    last_content_type, last_content_id, muted_until, banned_at, is_permanent, updated_at
  )
  values (
    p_user_id, coalesce(p_username, 'unknown'), new_count, p_reason, p_kind,
    p_content_type, p_content_id, muted, case when permanent then now() else null end,
    permanent, now()
  )
  on conflict (user_id) do update
    set username = excluded.username,
        strike_count = excluded.strike_count,
        last_reason = excluded.last_reason,
        last_kind = excluded.last_kind,
        last_content_type = excluded.last_content_type,
        last_content_id = excluded.last_content_id,
        muted_until = coalesce(excluded.muted_until, public.user_strikes.muted_until),
        banned_at = coalesce(excluded.banned_at, public.user_strikes.banned_at),
        is_permanent = public.user_strikes.is_permanent or excluded.is_permanent,
        updated_at = now();

  -- Audit trail.
  insert into public.moderation_log (
    action, actor, auto, reason, username, user_id,
    is_permanent, expires_at, window_hours
  )
  values (
    action, 'auto-moderation', true, p_reason, coalesce(p_username, 'unknown'), p_user_id,
    permanent, muted, case when muted is null then null else 24 end
  );

  if permanent then
    -- Mirror into banned_users so the existing BanGate / admin screens see it.
    -- Guarded so a pre-existing manual ban row does not raise a unique
    -- violation and abort the whole ladder. Without this, banning someone an
    -- admin had already banned would fail and record nothing.
    insert into public.banned_users (
      username, user_id, reason, kind, is_permanent, auto, banned_by, expires_at
    )
    select
      coalesce(p_username, 'unknown'), p_user_id, p_reason, 'ban', true, true, 'auto-moderation', null
    where not exists (
      select 1 from public.banned_users b
      where b.user_id = p_user_id
         or lower(btrim(b.username)) = lower(btrim(coalesce(p_username, '')))
    );

    -- Burn every identity we can attribute to this account.
    begin
      select u.email, u.phone into target_email, target_phone
      from auth.users u where u.id = p_user_id;
    exception when others then
      target_email := null;
      target_phone := null;
    end;

    perform public.ban_identity('email', target_email, p_reason, p_user_id, p_username);
    perform public.ban_identity('phone', target_phone, p_reason, p_user_id, p_username);

    for dev in select device_id from public.user_devices where user_id = p_user_id loop
      perform public.ban_identity('device', dev.device_id, p_reason, p_user_id, p_username);
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'strike', new_count,
    'action', action,
    'permanent', permanent,
    'muted_until', muted,
    'deleted', deleted,
    'message', message
  );
end;
$$;

revoke all on function public.auto_moderate(uuid, text, text, text, text, uuid) from public;
grant execute on function public.auto_moderate(uuid, text, text, text, text, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Status for the signed-in user
-- ---------------------------------------------------------------------------
create or replace function public.my_strike_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row_strike public.user_strikes%rowtype;
begin
  if uid is null then
    return jsonb_build_object('strike_count', 0, 'muted', false, 'is_permanent', false);
  end if;

  select * into row_strike from public.user_strikes where user_id = uid;

  return jsonb_build_object(
    'strike_count', coalesce(row_strike.strike_count, 0),
    'muted', coalesce(row_strike.muted_until > now(), false),
    'muted_until', row_strike.muted_until,
    'is_permanent', coalesce(row_strike.is_permanent, false),
    'last_reason', row_strike.last_reason,
    'last_kind', row_strike.last_kind
  );
end;
$$;

grant execute on function public.my_strike_status() to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Admin Ban List (what they did + which warning)
-- ---------------------------------------------------------------------------
create or replace function public.admin_ban_list()
returns table (
  id uuid,
  username text,
  user_id uuid,
  kind text,
  reason text,
  strike_count integer,
  last_kind text,
  last_content_type text,
  is_permanent boolean,
  auto boolean,
  banned_by text,
  expires_at timestamptz,
  created_at timestamptz,
  active boolean,
  identity_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'not_authorized';
  end if;

  return query
  select
    b.id,
    b.username,
    b.user_id,
    b.kind,
    b.reason,
    coalesce(s.strike_count, 0)::integer,
    s.last_kind,
    s.last_content_type,
    b.is_permanent,
    b.auto,
    b.banned_by,
    b.expires_at,
    b.created_at,
    (b.is_permanent or b.expires_at is null or b.expires_at > now()) as active,
    (
      select count(*) from public.identity_bans ib
      where ib.banned_user_id = b.user_id and ib.active
    ) as identity_count
  from public.banned_users b
  left join public.user_strikes s on s.user_id = b.user_id
  order by b.created_at desc
  limit 500;
end;
$$;

grant execute on function public.admin_ban_list() to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Owner-only unban
-- ---------------------------------------------------------------------------
create or replace function public.owner_unban(p_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if not public.is_owner() then
    return jsonb_build_object('ok', false, 'error', 'owner_only');
  end if;

  select b.user_id into target
  from public.banned_users b
  where lower(btrim(b.username)) = lower(btrim(p_username))
  limit 1;

  delete from public.banned_users
  where lower(btrim(username)) = lower(btrim(p_username));

  if target is not null then
    update public.user_strikes
       set strike_count = 0,
           is_permanent = false,
           banned_at = null,
           muted_until = null,
           updated_at = now()
     where user_id = target;

    update public.identity_bans
       set active = false
     where banned_user_id = target;
  end if;

  insert into public.moderation_log (action, actor, auto, reason, username, user_id)
  values ('unban', 'owner', false, 'Unbanned by owner', p_username, target);

  return jsonb_build_object('ok', true, 'username', p_username);
end;
$$;

grant execute on function public.owner_unban(text) to authenticated;
