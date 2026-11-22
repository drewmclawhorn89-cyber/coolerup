-- 0027_ai_safety_bot.sql
-- ============================================================================
-- Coolerup · Coolerup Safety Bot
-- ============================================================================
-- The AI moderator that watches every new video, comment, DM, bio and profile
-- picture. This migration is the database half:
--
--   1. Makes the 3-strike ladder the ONLY escalation path. The previous
--      migration (20261218000000_instant_ban_sexual.sql) banned explicit
--      sexual content on the first offence. That is now removed: sexual
--      content climbs 1 -> 2 -> 3 like every other violation.
--   2. Never lets the ladder touch the owner (@drewmclawhorn3) or an admin.
--   3. Adds the columns the AI Bot Logs screen reads (kind, content type/id,
--      a short excerpt of what was removed) and the admin_bot_logs() RPC.
--   4. Rewrites report_content() so that 5 distinct reporters + the Safety
--      Bot agreeing auto-hides the video until the owner reviews it.
--
-- Everything is idempotent and safe to re-run.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Core tables (already created by 20261217, re-stated idempotently so this
--    migration also works on a database that never ran it)
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
-- 2. Helpers
-- ---------------------------------------------------------------------------
create or replace function public.identity_hash(_value text)
returns text
language sql
immutable
as $$
  select md5(lower(btrim(coalesce(_value, ''))));
$$;

-- "Is the signed-in user the owner?" — the only account allowed to unban.
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

-- Uid-based variant used by the ladder so it can refuse to act on the owner
-- even when the call comes from service_role (where auth.uid() is null).
create or replace function public.is_owner_uid(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = _uid
      and lower(btrim(coalesce(p.handle, ''))) = 'drewmclawhorn3'
  );
$$;

grant execute on function public.is_owner_uid(uuid) to authenticated, service_role;

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
-- 3. moderation_log: the columns the AI Bot Logs screen needs
-- ---------------------------------------------------------------------------
alter table public.moderation_log add column if not exists kind text;
alter table public.moderation_log add column if not exists content_type text;
alter table public.moderation_log add column if not exists content_id uuid;
alter table public.moderation_log add column if not exists content_excerpt text;
alter table public.moderation_log add column if not exists strike_count integer;

create index if not exists moderation_log_auto_idx
  on public.moderation_log (auto, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. The ladder — one path for every violation kind
-- ---------------------------------------------------------------------------
create or replace function public.auto_moderate(
  p_user_id uuid,
  p_username text,
  p_kind text,                 -- sexual | bullying | threat | pii | fake | spam | other
  p_reason text,
  p_content_type text default null,   -- video | comment | profile_pic | profile | message | none
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
  excerpt text;
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

  -- Never auto-ban the owner or an admin. Moderation must not be able to take
  -- out the people who run the app.
  if public.is_owner_uid(p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'target_is_owner', 'strike', 0);
  end if;
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

  -- Every violation kind climbs the same ladder. Explicit sexual content is
  -- NOT an instant ban any more — 1st = warning, 2nd = 24h mute, 3rd = ban.
  new_count := coalesce(row_strike.strike_count, 0) + 1;
  if new_count > 3 then new_count := 3; end if;

  -- Capture a short excerpt of what is being removed, before deleting it, so
  -- the AI Bot Logs screen can show the owner exactly what was actioned.
  if p_content_id is not null then
    if p_content_type = 'comment' then
      begin
        select left(coalesce(body, ''), 280) into excerpt
          from public.comments where id = p_content_id;
      exception when others then
        excerpt := null;
      end;
    elsif p_content_type = 'video' then
      begin
        select left(coalesce(caption, ''), 280) into excerpt
          from public.videos where id = p_content_id;
      exception when others then
        excerpt := null;
      end;
    end if;
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
    message := 'Warning 3/3 — This breaks Coolerup rules. Your account is permanently banned.';
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

  -- Audit trail (this is what the AI Bot Logs screen reads).
  insert into public.moderation_log (
    action, actor, auto, reason, username, user_id,
    is_permanent, expires_at, window_hours,
    kind, content_type, content_id, content_excerpt, strike_count
  )
  values (
    action, 'Coolerup Safety Bot', true, p_reason, coalesce(p_username, 'unknown'), p_user_id,
    permanent, muted, case when muted is null then null else 24 end,
    p_kind, p_content_type, p_content_id, excerpt, new_count
  );

  if permanent then
    -- Mirror into banned_users so the existing BanGate / admin screens see it.
    -- Guarded so a pre-existing manual ban row does not raise a unique
    -- violation and abort the whole ladder.
    insert into public.banned_users (
      username, user_id, reason, kind, is_permanent, auto, banned_by, expires_at
    )
    select
      coalesce(p_username, 'unknown'), p_user_id, p_reason, 'ban', true, true, 'Coolerup Safety Bot', null
    where not exists (
      select 1 from public.banned_users b
      where b.user_id = p_user_id
         or lower(btrim(b.username)) = lower(btrim(coalesce(p_username, '')))
    );

    -- Burn every identity we can attribute to this account so a fresh account
    -- cannot be created from the same email / phone / device.
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
-- 5. Status for the signed-in user
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
-- 6. Reports: widen the reason list to include 'sexual'
-- ---------------------------------------------------------------------------
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in (
    'violence', 'hate', 'nudity', 'sexual', 'spam', 'harassment',
    'minor', 'illegal', 'scam', 'other'
  ));

-- ---------------------------------------------------------------------------
-- 7. report_content(): record the report, then auto-hide on 5 + bot agreement
-- ---------------------------------------------------------------------------
create or replace function public.report_content(
  _video_id uuid,
  _reported_username text,
  _reason text,
  _details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_my_handle text;
  v_target_handle text := public.norm_handle(_reported_username);
  v_target_id uuid;
  v_dup boolean;
  v_count integer;
  v_bot_agrees boolean := false;
  v_caption text;
  v_hidden boolean := false;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in to report');
  end if;

  select public.norm_handle(p.handle) into v_my_handle
    from public.profiles p where p.id = v_me limit 1;

  if v_target_handle is null or v_target_handle = '' then
    return jsonb_build_object('ok', false, 'error', 'Unknown user');
  end if;

  if v_my_handle = v_target_handle then
    return jsonb_build_object('ok', false, 'error', 'You can''t report yourself');
  end if;

  if _reason not in (
    'violence','hate','nudity','sexual','spam','harassment',
    'minor','illegal','scam','other'
  ) then
    return jsonb_build_object('ok', false, 'error', 'Invalid reason');
  end if;

  select p.id into v_target_id from public.profiles p
   where public.norm_handle(p.handle) = v_target_handle limit 1;

  -- One report per user per video per reason every 7 days.
  select exists (
    select 1 from public.reports r
    where r.reporter_id = v_me
      and public.norm_handle(r.reported_username) = v_target_handle
      and r.reason = _reason
      and (r.video_id is not distinct from _video_id)
      and r.created_at >= now() - interval '7 days'
  ) into v_dup;

  if v_dup then
    return jsonb_build_object('ok', true, 'duplicate', true, 'banned', false, 'hidden', false);
  end if;

  insert into public.reports (
    reporter_id, reporter_username, reported_username, reported_user_id,
    reported_video_id, video_id, reason, details, status
  )
  values (
    v_me, coalesce(v_my_handle, 'unknown'), v_target_handle, v_target_id,
    _video_id::text, _video_id, _reason,
    nullif(btrim(coalesce(_details, '')), ''), 'pending'
  );

  -- Reports never ban anyone. They can only hide a video for review.
  if _video_id is null then
    return jsonb_build_object('ok', true, 'banned', false, 'hidden', false);
  end if;

  -- How many distinct people reported THIS video in the last 7 days?
  select count(distinct r.reporter_id) into v_count
    from public.reports r
   where r.video_id = _video_id
     and r.created_at >= now() - interval '7 days';

  -- Does the Safety Bot agree? Either the caption trips the banned-word
  -- filter, or the report reason is one of the severe categories.
  select coalesce(caption, '') into v_caption
    from public.videos where id = _video_id limit 1;

  v_bot_agrees :=
    public.contains_banned_word(v_caption)
    or _reason in ('nudity','sexual','hate','violence','harassment','minor');

  if v_count >= 5 and v_bot_agrees then
    update public.videos
       set hidden = true,
           hidden_reason = 'Auto-hidden: 5+ reports and Safety Bot agreement — pending owner review'
     where id = _video_id
       and hidden = false;

    if found then
      v_hidden := true;

      insert into public.moderation_log (
        action, actor, auto, reason, username, user_id,
        content_type, content_id, content_excerpt, strike_count
      )
      values (
        'auto_hide', 'Coolerup Safety Bot', true,
        '5+ reports and Safety Bot agreement', v_target_handle, v_target_id,
        'video', _video_id, left(coalesce(v_caption, ''), 280), 0
      );
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'banned', false,
    'hidden', v_hidden,
    'report_count', v_count
  );
end;
$$;

grant execute on function public.report_content(uuid, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. AI Bot Logs (admin only)
-- ---------------------------------------------------------------------------
create or replace function public.admin_bot_logs(p_limit integer default 200)
returns table (
  id uuid,
  username text,
  user_id uuid,
  action text,
  reason text,
  kind text,
  content_type text,
  content_id uuid,
  content_excerpt text,
  strike_count integer,
  is_permanent boolean,
  expires_at timestamptz,
  auto boolean,
  actor text,
  created_at timestamptz
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
    l.id,
    l.username,
    l.user_id,
    l.action,
    l.reason,
    l.kind,
    l.content_type,
    l.content_id,
    l.content_excerpt,
    l.strike_count,
    l.is_permanent,
    l.expires_at,
    l.auto,
    l.actor,
    l.created_at
  from public.moderation_log l
  where l.auto = true
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

grant execute on function public.admin_bot_logs(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Owner-only unban (clears the ladder + identity bans)
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

-- ---------------------------------------------------------------------------
-- 10. Refresh PostgREST's schema cache
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';
