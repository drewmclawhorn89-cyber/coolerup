-- #####################################################################
-- #                                                                   #
-- #   COOLERUP SAFETY BOT  --  EVERYTHING, ONE PASTE                  #
-- #                                                                   #
-- #####################################################################
--
-- HOW TO USE
--   1. Supabase dashboard -> SQL Editor -> New query.
--   2. Paste this ENTIRE file.
--   3. Press Run. It takes a few seconds.
--   4. Scroll to the very bottom and read the checklist it prints.
--
-- It is safe to run more than once. Running it again just re-applies the
-- same rules; it will not create duplicates and it will not delete your
-- videos.
--
-- ORDER MATTERS, and this file is already in the right order:
--   Part 1  tables, strikes, the 3-strike ladder, reports
--   Part 2  the bot's real account + its own takedown path
--   Part 3  the database triggers that remove bad content instantly
--
-- WHAT THE BOT DOES
--   * Watches videos, comments, messages, bios and display names 24/7.
--   * Checks for: sexual / explicit content, bullying and hate, threats,
--     passwords and personal info, fake or impersonating accounts, spam.
--   * Does NOT flag reposts of other people's videos.
--   * Never touches the owner (@drewmclawhorn3).
--   * 1st strike  -> content removed + Warning 1/3
--     2nd strike  -> content removed + Warning 2/3 + 24 hour mute
--     3rd strike  -> Warning 3/3 + permanent ban, and new accounts on the
--                    same phone / email / device are blocked
--
-- AFTER IT RUNS
--   Open Admin -> AI Bot Logs and press "Clean the app now" once. The
--   triggers only police NEW content; that button sweeps everything that
--   was already posted before you ran this.
--
-- #####################################################################


-- ==================================================================
--  PART 1 of 3  ·  Bans, strikes and the 3-strike ladder
-- ==================================================================

-- Coolerup · Coolerup Safety Bot — paste this whole file into the Supabase SQL editor.
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

-- ==================================================================
--  PART 2 of 3  ·  The real Safety Bot account
-- ==================================================================

-- ===========================================================================
-- PASTE THIS INTO THE SUPABASE SQL EDITOR (run once, after the auto-bans
-- script). It creates the REAL Coolerup Safety Bot account: a real auth user,
-- a real profile, a real moderator role, and the bot's own takedown function.
--
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 0029_real_safety_bot_account.sql
--
-- Turns the Coolerup Safety Bot from a *virtual* profile (rendered from
-- constants in the client) into a REAL account:
--
--   * a real row in auth.users (random password, nobody can sign in as it)
--   * a real row in public.profiles with handle `coolerup_safety`
--   * a real `moderator` role in public.user_roles
--   * a real avatar at /safety-bot.png
--
-- Because the handle is now taken in the database, nobody can register
-- `coolerup_safety` and impersonate the bot.
--
-- It also gives the bot real authority:
--   * public.safety_bot_uid() / public.is_safety_bot_uid(uuid)
--   * public.bot_takedown(...)  -> the bot's own removal path
--   * auto_moderate() now records actor_id and refuses to act on the bot
--
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Identity constants
-- ---------------------------------------------------------------------------
create or replace function public.safety_bot_uid()
returns uuid
language sql
immutable
as $$
  select '00000000-0000-4000-8000-0000000005af'::uuid;
$$;

create or replace function public.is_safety_bot_uid(_uid uuid)
returns boolean
language sql
immutable
as $$
  select _uid is not null and _uid = public.safety_bot_uid();
$$;

grant execute on function public.safety_bot_uid() to anon, authenticated, service_role;
grant execute on function public.is_safety_bot_uid(uuid) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. The account itself
-- ---------------------------------------------------------------------------
do $$
declare
  bot_uid uuid := public.safety_bot_uid();
  bot_email text := 'safety-bot@coolerup.app';
  bot_instance uuid;
begin
  -- Supabase stores a row in auth.instances; auth.users.instance_id is a FK to
  -- it. Hardcoding the zero uuid fails on projects where that row is missing,
  -- so look up the real one and only fall back to the zero uuid.
  if to_regclass('auth.instances') is not null then
    select coalesce((select i.id from auth.instances i order by i.id limit 1),
                    '00000000-0000-0000-0000-000000000000'::uuid)
      into bot_instance;
  else
    bot_instance := '00000000-0000-0000-0000-000000000000'::uuid;
  end if;
  -- auth.users: the real account. The password is random and never stored, so
  -- there is no way to sign in as the bot.
  if not exists (select 1 from auth.users u where u.id = bot_uid) then
    begin
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change_token_new, email_change
      )
      values (
        bot_instance,
        bot_uid,
        'authenticated',
        'authenticated',
        bot_email,
        -- bcrypt hash of a 64-char random string that was thrown away.
        -- Nobody knows the plaintext, so nobody can sign in as the bot.
        '$2a$10$UAuLYr7cEqBmgFOwAgLc8uYoOGXs3MIcEs4HFzq.eQaNRUycES1hG',
        now(), now(), now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'coolerup_bot', true),
        jsonb_build_object('coolerup_bot', true, 'handle', 'coolerup_safety'),
        '', '', '', ''
      );
    exception when others then
      -- Do NOT swallow this. A silent failure here is why the bot never
      -- appeared: the script finished "successfully" with no account.
      raise exception
        'SAFETY BOT SETUP FAILED at auth.users insert [%]: %', sqlstate, sqlerrm;
    end;
  end if;

  -- auth.identities keeps GoTrue happy if it ever looks the account up.
  -- Nested on purpose: PL/pgSQL plans a whole IF expression as one query, so
  -- `to_regclass(...) is not null and exists (select ... from auth.identities)`
  -- still resolves the table and errors on projects where it is absent.
  if to_regclass('auth.identities') is not null then
    if exists (select 1 from auth.users u where u.id = bot_uid)
       and not exists (select 1 from auth.identities i where i.user_id = bot_uid) then
      begin
        insert into auth.identities (
          provider_id, user_id, identity_data, provider,
          last_sign_in_at, created_at, updated_at
        )
        values (
          bot_uid::text,
          bot_uid,
          jsonb_build_object('sub', bot_uid::text, 'email', bot_email, 'email_verified', true),
          'email',
          now(), now(), now()
        );
      exception when others then
        -- Non-fatal: the profile is what the app reads. But say it loudly.
        raise warning 'safety bot auth.identities insert skipped [%]: %', sqlstate, sqlerrm;
      end;
    end if;
  end if;

  -- public.profiles: the real profile row the whole app reads.
  if exists (select 1 from auth.users u where u.id = bot_uid) then
    if exists (
      select 1 from public.profiles p
      where lower(btrim(p.handle)) = 'coolerup_safety' and p.id <> bot_uid
    ) then
      raise notice 'handle coolerup_safety is taken by another account; bot profile not created';
    else
      insert into public.profiles (id, handle, display_name, bio, avatar_url)
      values (
        bot_uid,
        'coolerup_safety',
        'Coolerup Safety Bot',
        'I watch new videos, comments, messages, bios and profile pictures 24/7. I remove content that breaks the rules and apply the 3-strike ladder. I never flag you for reposting someone else''s video.',
        '/safety-bot.png'
      )
      on conflict (id) do update
        set handle = excluded.handle,
            display_name = excluded.display_name,
            bio = excluded.bio,
            avatar_url = excluded.avatar_url;

    end if;

    -- A real role, so every has_role() check in the app sees a moderator.
    insert into public.user_roles (user_id, role)
    values (bot_uid, 'moderator'::public.app_role)
    on conflict (user_id, role) do nothing;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Audit trail: remember *which* account acted
-- ---------------------------------------------------------------------------
alter table public.moderation_log
  add column if not exists actor_id uuid;

-- ---------------------------------------------------------------------------
-- 4. The ladder, now bot-aware
--    (same behaviour as 0027, plus: the bot can never be moderated, and every
--     row records actor_id = the real bot account)
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
  if public.is_safety_bot_uid(p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'target_is_bot', 'strike', 0);
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
    action, actor, actor_id, auto, reason, username, user_id,
    is_permanent, expires_at, window_hours,
    kind, content_type, content_id, content_excerpt, strike_count
  )
  values (
    action, 'Coolerup Safety Bot', public.safety_bot_uid(), true, p_reason,
    coalesce(p_username, 'unknown'), p_user_id,
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
-- 5. The bot's own removal path
--
-- Called by the app (or by the owner / service_role) when the Safety Bot has
-- decided something must come down. It refuses to act on the owner, admins or
-- the bot itself, and it always writes the audit row with the bot as actor.
-- ---------------------------------------------------------------------------
create or replace function public.bot_takedown(
  p_username text,
  p_kind text,
  p_reason text,
  p_content_type text default null,
  p_content_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid;
begin
  if auth.uid() is not null
     and not public.is_safety_bot_uid(auth.uid())
     and not public.has_role(auth.uid(), 'admin')
     and not public.is_owner() then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select p.id into target
  from public.profiles p
  where lower(btrim(coalesce(p.handle, ''))) = lower(btrim(coalesce(p_username, '')))
  limit 1;

  if target is null then
    return jsonb_build_object('ok', false, 'error', 'no_user');
  end if;

  return public.auto_moderate(target, p_username, p_kind, p_reason, p_content_type, p_content_id);
end;
$$;

revoke all on function public.bot_takedown(text, text, text, text, uuid) from public;
grant execute on function public.bot_takedown(text, text, text, text, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';


-- Sanity checks -------------------------------------------------------------
-- These raise instead of returning empty rows, so "it did not work" can never
-- look like success again.
do $$
declare
  bot_uid uuid := public.safety_bot_uid();
begin
  if not exists (select 1 from auth.users u where u.id = bot_uid) then
    raise exception 'CHECK FAILED: no auth.users row for the safety bot';
  end if;
  if not exists (select 1 from public.profiles p where p.id = bot_uid) then
    raise exception 'CHECK FAILED: no public.profiles row for the safety bot';
  end if;
  if not exists (
    select 1 from public.user_roles r
    where r.user_id = bot_uid and r.role = 'moderator'::public.app_role
  ) then
    raise exception 'CHECK FAILED: safety bot has no moderator role';
  end if;
  raise notice 'SAFETY BOT OK: account, profile and moderator role all exist';
end
$$;

select public.safety_bot_uid() as bot_uid;
select id, handle, display_name, avatar_url
  from public.profiles where id = public.safety_bot_uid();
select user_id, role from public.user_roles where user_id = public.safety_bot_uid();

-- ==================================================================
--  PART 3 of 3  ·  Instant takedown (server-side triggers)
-- ==================================================================

-- =====================================================================
-- Coolerup · Instant takedown (server-side moderation)
-- =====================================================================
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- Safe to run more than once.
--
-- What it changes:
--   * Adds videos.hidden / hidden_reason / hidden_at / hidden_by so a
--     video can be taken out of every feed without deleting the row.
--   * Adds public.safety_classify(): the same rules the app used in the
--     browser, now living in Postgres, so they cannot be skipped.
--   * Adds BEFORE INSERT / BEFORE UPDATE triggers on videos, comments,
--     messages and profiles. A bad video is hidden the instant it is
--     saved. A bad comment or message is refused (never stored). A bad
--     bio is blanked.
--   * Reposts of other people's videos are exempt, and the owner
--     (@drewmclawhorn3) is never touched.
--   * Adds safety_bot_sweep() to clean content posted BEFORE this ran,
--     and purge_hidden_videos() to delete hidden rows for good.
--   * Adds a RESTRICTIVE select policy so hidden videos and removed
--     comments are invisible to the app even if a query forgets to
--     filter on hidden.
--
-- After it runs, open Admin -> AI Bot Logs and press "Clean the app now"
-- once, to sweep the backlog.
-- =====================================================================

-- ===========================================================================
-- 0030 · INSTANT TAKEDOWN
--
-- The problem this fixes: content was only screened *by the app*, after it had
-- already been written, by a classifier that runs in the browser. If the
-- classifier failed to load, if the post came in through a path that did not
-- call it (TikTok sync, a repost, a direct API call), or if the moderation RPC
-- was missing, the post stayed up. Nothing was removed "right away".
--
-- This migration moves the decision into Postgres, where it cannot be skipped:
--
--   * videos   -> BEFORE INSERT/UPDATE trigger hides the row the instant it is
--                 written, so it never appears in a feed, a profile grid or a
--                 search result. The row is kept (not deleted) so the owner can
--                 still see what was removed in AI Bot Logs and restore it.
--   * comments -> BEFORE INSERT trigger cancels the write outright.
--   * messages -> BEFORE INSERT trigger cancels the write outright.
--   * profiles -> BEFORE UPDATE trigger blanks a bio / display name that trips
--                 the filter.
--
-- Matching is done by `public.safety_classify()`, a self-contained port of the
-- client classifier. It does not depend on `banned_words` being populated, and
-- it is deliberately word-exact so "analysis" is not "anal" and "Pakistan" is
-- not a slur.
--
-- Reposts are explicitly exempt: a repost carries `source_id` / `source_url`
-- and the trigger returns early for those rows. The owner's own account is
-- exempt too.
--
-- Idempotent: safe to run more than once.
-- ===========================================================================

-- ===========================================================================
-- 0030 · INSTANT TAKEDOWN
--
-- The problem this fixes: content was only screened *by the app*, after it had
-- already been written, by a classifier that runs in the browser. If the
-- classifier failed to load, if the post came in through a path that did not
-- call it (TikTok sync, a repost, a direct API call), or if the moderation RPC
-- was missing, the post stayed up. Nothing was removed "right away".
--
-- This migration moves the decision into Postgres, where it cannot be skipped:
--
--   * videos   -> BEFORE INSERT/UPDATE trigger hides the row the instant it is
--                 written, so it never appears in a feed, a profile grid or a
--                 search result. The row is kept (not deleted) so the owner can
--                 still see what was removed in AI Bot Logs and restore it.
--   * comments -> BEFORE INSERT trigger cancels the write outright.
--   * messages -> BEFORE INSERT trigger cancels the write outright.
--   * profiles -> BEFORE UPDATE trigger blanks a bio / display name that trips
--                 the filter.
--
-- Matching is done by `public.safety_classify()`, a self-contained port of the
-- client classifier. It does not depend on `banned_words` being populated, and
-- it is deliberately word-exact so "analysis" is not "anal" and "Pakistan" is
-- not a slur.
--
-- Reposts are explicitly exempt: a repost carries `source_id` / `source_url`
-- and the trigger returns early for those rows. The owner's own account is
-- exempt too.
--
-- Idempotent: safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns the takedown path needs
-- ---------------------------------------------------------------------------

alter table public.videos add column if not exists hidden boolean not null default false;
alter table public.videos add column if not exists hidden_reason text;
alter table public.videos add column if not exists hidden_at timestamptz;
alter table public.videos add column if not exists hidden_by text;
alter table public.videos add column if not exists user_id uuid;

-- Backfill the owner of every existing video so the trigger can exempt the
-- owner and the log can name a real account.
update public.videos v
   set user_id = p.id
  from public.profiles p
 where v.user_id is null
   and lower(btrim(p.handle)) = lower(btrim(coalesce(v.username, '')));

create index if not exists videos_hidden_idx on public.videos (hidden);
create index if not exists videos_hidden_at_idx on public.videos (hidden_at desc);

-- ---------------------------------------------------------------------------
-- 2. The classifier
-- ---------------------------------------------------------------------------

/**
 * Fold leetspeak and punctuation so `p0rn`, `p.o.r.n` and `PORN` all match.
 * Mirrors `normalize()` in src/lib/autoBans.ts.
 */
create or replace function public.safety_normalize(_text text)
returns text
language sql
immutable
as $$
  select ' ' || btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     regexp_replace(lower(coalesce(_text, '')), '[0@]', 'o', 'g'),
                   '[1!|]', 'i', 'g'),
                 '3', 'e', 'g'),
               '4', 'a', 'g'),
             '[5$]', 's', 'g'),
           '[^a-z ]', ' ', 'g')
         ) || ' ';
$$;

/**
 * Return the violation kind for a piece of text, or null when it is clean.
 *
 * Kinds, most serious first: threat, sexual, bullying, pii, spam. The first
 * match wins so the reason shown to the poster is the worst thing they did.
 *
 * `_scope` narrows the check: 'caption' and 'comment' skip the PII rules that
 * only make sense on a profile, and 'profile' skips the spam-link rules.
 */
create or replace function public.safety_classify(_text text, _scope text default 'any')
returns text
language plpgsql
immutable
as $$
declare
  n text;
  raw text := coalesce(_text, '');
begin
  if btrim(raw) = '' then
    return null;
  end if;
  n := public.safety_normalize(raw);

  -- Threats of violence.
  if n ~ (' (i will kill|i ll kill|im gonna kill|i m gonna kill|i will hurt|i ll hurt|'
       || 'i will find you|i know where you live|watch your back|you re dead|youre dead|'
       || 'ur dead|you are dead|i will shoot|i ll shoot|i will stab|i ll stab|'
       || 'bomb your|i will rape|i ll rape|rape you|beat you up|jump you|'
       || 'hunt you down|come for you|put you in the ground|slit your throat|'
       || 'break your neck|smash your face) ') then
    return 'threat';
  end if;

  -- Explicit sexual content.
  if n ~ (' (porn|porno|pornhub|xvideos|xhamster|onlyfans|only fans|nudes|naked|'
       || 'sexting|sextape|blowjob|handjob|rimjob|cumshot|jizz|creampie|dildo|'
       || 'vibrator|orgy|threesome|hentai|nsfw|milf|striptease|strip tease|camgirl|'
       || 'escort|send nudes|nude pics|nude selfie|fuck me|suck my|jerking off|'
       || 'masturbat|erotic|fetish|bdsm|pussy|dick pic|dick pics|cock pic|boobs|'
       || 'titties|horny|sext|sex tape|sex video|sex vid|nude video|xxx video|'
       || 'adult content|porn video|squirting|orgasm|clit|penis|vagina|anus|'
       || 'nipples|stripper|strip club|webcam sex|snap for nudes|kik for nudes|'
       || 'trade nudes) ') then
    return 'sexual';
  end if;

  -- Bullying, hate and dehumanising language.
  if n ~ (' (retard|retarded|spastic|mongoloid|tranny|faggot|fag|dyke|nigger|nigga|'
       || 'coon|chink|gook|spic|wetback|kike|paki|raghead|towelhead|sandnigger|'
       || 'beaner|cripple|fatass|fat ass|lardass|ugly bitch|worthless|kill yourself|'
       || 'kys|go die|nobody loves you|no one loves you|you should die|subhuman|'
       || 'vermin|freak|loser|waste of space|waste of air|kill urself|end yourself|'
       || 'drink bleach|idiot|moron|imbecile|dumbass|dumb ass|dumb bitch|'
       || 'stupid bitch|bitch|bitches|son of a bitch|bastard|whore|whores|slut|'
       || 'sluts|skank|thot|cunt|prick|douche|douchebag|scumbag|trash human|'
       || 'human trash|pathetic|shut up|nobody cares|no one cares|nobody asked|'
       || 'no one asked|nobody likes you|no one likes you|everyone hates you|'
       || 'you have no friends|youre worthless|you are worthless|youre nothing|'
       || 'you are nothing|youre a joke|you are a joke|ugliest|disgusting|'
       || 'go away forever|hope you die|unalive yourself|off yourself|hang yourself|'
       || 'go hang|slit your wrists|cut yourself|you should be dead|better off dead|'
       || 'no one would miss you|nobody would miss you|neck yourself) ') then
    return 'bullying';
  end if;

  -- Passwords, card numbers, SSNs, phone numbers, home addresses.
  if _scope <> 'comment' then
    if raw ~* '\m(?:my|the|your)?\s*(?:password|passcode|pass word|login|log in|pin)\s*(?:is|:|=)\s*\S+'
       or raw ~* '\m(?:here(?:''s| is)|send me|text me|dm me)\s+(?:my\s+)?(?:password|login|pin)\M'
       or raw ~ '\m\d{3}-\d{2}-\d{4}\M'
       or raw ~ '\m(?:\d[ -]*?){13,16}\M'
       or raw ~ '\m(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\M'
       or raw ~* '\m(?:my|home|street)\s+address\s*(?:is|:)\s*\d+\s+\S+'
       or raw ~* '\m\d{1,5}\s+[A-Za-z0-9.''-]+(?:\s+[A-Za-z0-9.''-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd)\M'
    then
      return 'pii';
    end if;
  end if;

  -- Fake accounts: claiming to be Coolerup staff, or baiting people into a
  -- "verification" that asks for a password. Only strong signals count; a new
  -- account with few followers is not a fake account.
  if _scope in ('any', 'profile') then
    if n ~ (' (coolerup support|coolerup admin|coolerup official|coolerup team|'
         || 'coolerup mod|coolerup moderator|coolerup help|coolerup security|'
         || 'coolerup staff|coolerup verify|coolerup verification|'
         || 'loop support|loop admin|loop official|loop team|loop mod|'
         || 'loop moderator|loop help|loop security|loop staff) ')
       or raw ~* '\m(?:dm me to get verified|get verified here|free verification|verify your account here|send your password|i can get you verified)\M'
       or raw ~* '\m(?:i am|i''m|im|we are|official)\M[^.!?]{0,24}\m(?:coolerup|loop)\M[^.!?]{0,24}\m(?:admin|support|official|team|moderator|staff|security)\M'
    then
      return 'fake';
    end if;
  end if;

  -- Spam and scams.
  if _scope <> 'profile' then
    if n ~ (' (follow for follow|f4f|l4l|follow back|follow4follow|free followers|'
         || 'free likes|free coins|free diamonds|cash app|cashapp|venmo me|'
         || 'paypal me|send money|dm me to earn|dm for promo|click the link|'
         || 'click here to win|you have won|you ve won|claim your prize|'
         || 'crypto giveaway|bitcoin giveaway|double your|make money fast|'
         || 'work from home|investment opportunity|guaranteed profit|telegram me|'
         || 'whatsapp me|buy followers|cheap followers|followers for sale|'
         || 'selling followers|get followers|gain followers|real followers|'
         || 'sub for sub|sub4sub|like for like|like4like|comment for comment|'
         || 'earn money online|passive income|financial freedom|get rich quick|'
         || 'click my link|promo link|promo available|advertising space|'
         || 'dm for collab|dm for price|dm for details|serious buyers only|'
         || 'limited offer|act fast|first 100 people) ')
       or (select count(*) from regexp_matches(raw, 'https?://|www\.', 'gi')) >= 3
       or raw ~ '(.)\1{6,}'
    then
      return 'spam';
    end if;
  end if;

  return null;
end
$$;

grant execute on function public.safety_normalize(text) to anon, authenticated, service_role;
grant execute on function public.safety_classify(text, text) to anon, authenticated, service_role;

/** Human-readable reason for the AI Bot Logs screen. */
create or replace function public.safety_reason(_kind text)
returns text
language sql
immutable
as $$
  select case _kind
    when 'threat'   then 'Threat of violence'
    when 'sexual'   then 'Sexual or explicit content'
    when 'bullying' then 'Bullying or hate speech'
    when 'pii'      then 'Personal information or login details'
    when 'spam'     then 'Spam or scam'
    when 'fake'     then 'Fake account or impersonation'
    else 'Breaks Coolerup rules'
  end;
$$;

grant execute on function public.safety_reason(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Logging helper
-- ---------------------------------------------------------------------------

/**
 * Write one AI Bot Logs row.
 *
 * Never raises: a logging failure must not undo a takedown that already
 * happened, and it must not block a clean post either.
 */
create or replace function public.safety_log(
  _user_id uuid,
  _username text,
  _action text,
  _kind text,
  _content_type text,
  _content_id uuid,
  _excerpt text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.moderation_log (
      action, actor, actor_id, auto, reason, username, user_id,
      kind, content_type, content_id, content_excerpt, strike_count,
      is_permanent
    )
    values (
      _action,
      'Coolerup Safety Bot',
      case when to_regprocedure('public.safety_bot_uid()') is not null
           then public.safety_bot_uid() else null end,
      true,
      public.safety_reason(_kind),
      lower(btrim(coalesce(_username, 'unknown'))),
      _user_id,
      _kind,
      _content_type,
      _content_id,
      left(coalesce(_excerpt, ''), 280),
      0,
      false
    );
  exception when others then
    -- The log table may not exist on a half-migrated database. Say so, move on.
    raise warning 'safety_log skipped: % (%)', sqlerrm, sqlstate;
  end;
end
$$;

grant execute on function public.safety_log(uuid, text, text, text, text, uuid, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Videos: hide on write
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_video()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  owner_uid uuid := new.user_id;
begin
  -- Reposts are other people's videos. They are never flagged.
  if new.source_id is not null
     or coalesce(new.source_url, '') <> ''
     or coalesce(new.is_tiktok, false) then
    return new;
  end if;

  if owner_uid is null then
    select p.id into owner_uid
      from public.profiles p
     where lower(btrim(p.handle)) = lower(btrim(coalesce(new.username, '')))
     limit 1;
  end if;

  -- Never touch the owner's own posts.
  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and public.is_owner_uid(owner_uid) then
    return new;
  end if;

  kind := public.safety_classify(new.caption, 'caption');
  if kind is null then
    return new;
  end if;

  -- Hide immediately. The row survives so the owner can review and restore it,
  -- but every feed, grid and search filters `hidden`, so nobody sees it.
  new.hidden := true;
  new.hidden_reason := public.safety_reason(kind) || ' (auto)';
  new.hidden_at := now();
  new.hidden_by := 'Coolerup Safety Bot';

  perform public.safety_log(
    owner_uid, new.username, 'video_hidden', kind, 'video', new.id, new.caption
  );

  return new;
end
$$;

drop trigger if exists videos_safety_guard on public.videos;
create trigger videos_safety_guard
  before insert on public.videos
  for each row execute function public.safety_guard_video();

-- Postgres cannot combine INSERT with UPDATE OF in one trigger, so the edit
-- path gets its own. A caption edit must not be able to sneak bad text past
-- the check that ran at upload time.
drop trigger if exists videos_safety_guard_update on public.videos;
create trigger videos_safety_guard_update
  before update of caption on public.videos
  for each row execute function public.safety_guard_video();

-- ---------------------------------------------------------------------------
-- 5. Comments: refuse the write
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  owner_uid uuid;
  video_owner uuid;
begin
  kind := public.safety_classify(new.body, 'comment');
  if kind is null then
    return new;
  end if;

  select v.user_id into video_owner from public.videos v where v.id = new.video_id;

  select p.id into owner_uid
    from public.profiles p
   where lower(btrim(p.handle)) = lower(btrim(coalesce(new.username, '')))
   limit 1;

  -- The owner and the video's own author may speak freely.
  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and (public.is_owner_uid(owner_uid) or public.is_owner_uid(video_owner)) then
    return new;
  end if;

  perform public.safety_log(
    owner_uid, new.username, 'comment_removed', kind, 'comment', new.id, new.body
  );

  -- Returning null cancels the insert: the comment never exists, so it cannot
  -- be read, counted or cached by anyone.
  return null;
end
$$;

drop trigger if exists comments_safety_guard on public.comments;
create trigger comments_safety_guard
  before insert on public.comments
  for each row execute function public.safety_guard_comment();

-- ---------------------------------------------------------------------------
-- 6. Direct messages: refuse the write
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
begin
  kind := public.safety_classify(new.message, 'any');
  if kind is null then
    return new;
  end if;

  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and public.is_owner_uid(new.sender_id) then
    return new;
  end if;

  perform public.safety_log(
    new.sender_id, null, 'message_blocked', kind, 'message', new.id, new.message
  );

  return null;
end
$$;

drop trigger if exists messages_safety_guard on public.messages;
create trigger messages_safety_guard
  before insert on public.messages
  for each row execute function public.safety_guard_message();

-- ---------------------------------------------------------------------------
-- 7. Profiles: blank a bad bio or display name
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  offending text;
begin
  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and public.is_owner_uid(new.id) then
    return new;
  end if;

  offending := coalesce(new.display_name, '') || ' ' || coalesce(new.bio, '');

  kind := public.safety_classify(offending, 'profile');
  if kind is null then
    return new;
  end if;

  -- Capture the offending text before it is blanked, or the log records
  -- nothing useful.
  perform public.safety_log(
    new.id, new.handle, 'profile_cleared', kind, 'profile', new.id, offending
  );

  new.bio := '[removed by Coolerup]';
  new.display_name := null;

  return new;
end
$$;

-- Two triggers, because Postgres cannot combine INSERT with UPDATE OF.
drop trigger if exists profiles_safety_guard on public.profiles;
create trigger profiles_safety_guard
  before update of bio, display_name on public.profiles
  for each row execute function public.safety_guard_profile();

drop trigger if exists profiles_safety_guard_insert on public.profiles;
create trigger profiles_safety_guard_insert
  before insert on public.profiles
  for each row execute function public.safety_guard_profile();

-- ---------------------------------------------------------------------------
-- 8. Sweep: clean what is already published
-- ---------------------------------------------------------------------------

/**
 * Re-scan everything that is already on the app.
 *
 * The triggers only protect new writes, so anything posted before this
 * migration is still live. This walks videos, comments and profiles and applies
 * the same rules. Returns a count per surface so the admin screen can show what
 * happened.
 *
 * Callable by the owner and admins only.
 */
create or replace function public.safety_bot_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_videos integer := 0;
  v_comments integer := 0;
  v_profiles integer := 0;
  r record;
  kind text;
begin
  if auth.uid() is not null
     and not public.has_role(auth.uid(), 'admin')
     and not (to_regprocedure('public.is_owner_uid(uuid)') is not null
              and public.is_owner_uid(auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  -- Videos.
  for r in
    select id, username, user_id, caption
      from public.videos
     where hidden = false
       and source_id is null
       and coalesce(source_url, '') = ''
       and coalesce(is_tiktok, false) = false
  loop
    if to_regprocedure('public.is_owner_uid(uuid)') is not null
       and public.is_owner_uid(r.user_id) then
      continue;
    end if;
    kind := public.safety_classify(r.caption, 'caption');
    if kind is null then
      continue;
    end if;
    update public.videos
       set hidden = true,
           hidden_reason = public.safety_reason(kind) || ' (sweep)',
           hidden_at = now(),
           hidden_by = 'Coolerup Safety Bot'
     where id = r.id;
    perform public.safety_log(r.user_id, r.username, 'video_hidden', kind, 'video', r.id, r.caption);
    v_videos := v_videos + 1;
  end loop;

  -- Comments: delete outright, there is nothing worth keeping.
  for r in
    select c.id, c.username, c.body
      from public.comments c
  loop
    kind := public.safety_classify(r.body, 'comment');
    if kind is null then
      continue;
    end if;
    perform public.safety_log(null, r.username, 'comment_removed', kind, 'comment', r.id, r.body);
    delete from public.comments where id = r.id;
    v_comments := v_comments + 1;
  end loop;

  -- Profiles.
  for r in
    select id, handle, display_name, bio from public.profiles
  loop
    if to_regprocedure('public.is_owner_uid(uuid)') is not null
       and public.is_owner_uid(r.id) then
      continue;
    end if;
    kind := public.safety_classify(
      coalesce(r.display_name, '') || ' ' || coalesce(r.bio, ''), 'profile'
    );
    if kind is null then
      continue;
    end if;
    perform public.safety_log(r.id, r.handle, 'profile_cleared', kind, 'profile', r.id,
                              coalesce(r.display_name, '') || ' ' || coalesce(r.bio, ''));
    update public.profiles
       set bio = '[removed by Coolerup]', display_name = null
     where id = r.id;
    v_profiles := v_profiles + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'videos_hidden', v_videos,
    'comments_removed', v_comments,
    'profiles_cleared', v_profiles
  );
end
$$;

revoke all on function public.safety_bot_sweep() from public;
grant execute on function public.safety_bot_sweep() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Purge: actually delete what was hidden
-- ---------------------------------------------------------------------------

/**
 * Delete every hidden video. Hiding is enough to keep it out of the app, but
 * the file still sits in storage and costs money. Owner and admins only.
 */
create or replace function public.purge_hidden_videos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is not null
     and not public.has_role(auth.uid(), 'admin')
     and not (to_regprocedure('public.is_owner_uid(uuid)') is not null
              and public.is_owner_uid(auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  with gone as (
    delete from public.videos where hidden = true returning id
  )
  select count(*) into n from gone;

  return jsonb_build_object('ok', true, 'deleted', n);
end
$$;

revoke all on function public.purge_hidden_videos() from public;
grant execute on function public.purge_hidden_videos() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Visibility: hidden rows must never be readable
-- ---------------------------------------------------------------------------

-- RESTRICTIVE, so it can only ever remove visibility, never grant it.
drop policy if exists "hide moderated videos" on public.videos;
create policy "hide moderated videos" on public.videos
  as restrictive for select to anon, authenticated
  using (not hidden);

-- Same idea for comments: nothing marked removed is readable.
drop policy if exists "hide removed comments" on public.comments;
create policy "hide removed comments" on public.comments
  as restrictive for select to anon, authenticated
  using (coalesce(body, '') <> '[removed by Coolerup]');

notify pgrst, 'reload schema';

-- =====================================================================
-- Verification: everything below should return one row per item.
-- =====================================================================
select 'videos.hidden column' as check, count(*)::text as found
from information_schema.columns
where table_schema = 'public' and table_name = 'videos' and column_name = 'hidden'
union all
select 'safety_classify()', count(*)::text from pg_proc
where proname = 'safety_classify'
union all
select 'safety_guard_video()', count(*)::text from pg_proc
where proname = 'safety_guard_video'
union all
select 'safety_guard_comment()', count(*)::text from pg_proc
where proname = 'safety_guard_comment'
union all
select 'safety_guard_message()', count(*)::text from pg_proc
where proname = 'safety_guard_message'
union all
select 'safety_guard_profile()', count(*)::text from pg_proc
where proname = 'safety_guard_profile'
union all
select 'safety_bot_sweep()', count(*)::text from pg_proc
where proname = 'safety_bot_sweep'
union all
select 'purge_hidden_videos()', count(*)::text from pg_proc
where proname = 'purge_hidden_videos'
union all
select 'triggers installed', count(*)::text from pg_trigger
where not tgisinternal and tgname in (
  'videos_safety_guard','videos_safety_guard_update','comments_safety_guard',
  'messages_safety_guard','profiles_safety_guard','profiles_safety_guard_insert'
)
union all
select 'hidden videos right now', count(*)::text from public.videos where hidden = true;


-- ---------------------------------------------------------------------
-- Bot account checks. Every row should say 1.
-- ---------------------------------------------------------------------
select 'bot: auth.users row' as check,
       count(*)::text as found
  from auth.users u where u.id = public.safety_bot_uid()
union all
select 'bot: profile row',
       count(*)::text
  from public.profiles p where p.id = public.safety_bot_uid()
union all
select 'bot: handle is coolerup_safety',
       count(*)::text
  from public.profiles p
 where p.id = public.safety_bot_uid()
   and lower(btrim(p.handle)) = 'coolerup_safety'
union all
select 'bot: moderator role',
       count(*)::text
  from public.user_roles r
 where r.user_id = public.safety_bot_uid()
   and r.role = 'moderator'::public.app_role
union all
select 'bot: safety_bot_uid() defined',
       count(*)::text from pg_proc where proname = 'safety_bot_uid'
union all
select 'ladder: auto_moderate() defined',
       count(*)::text from pg_proc where proname = 'auto_moderate'
union all
select 'ladder: bot_takedown() defined',
       count(*)::text from pg_proc where proname = 'bot_takedown'
union all
select 'reports: report_content() defined',
       count(*)::text from pg_proc where proname = 'report_content';

-- If any of the above is 0, tell the user plainly instead of failing silently.
do $$
declare
  missing text[] := array[]::text[];
begin
  if not exists (select 1 from auth.users where id = public.safety_bot_uid()) then
    missing := missing || 'auth.users row for the bot';
  end if;
  if not exists (select 1 from public.profiles where id = public.safety_bot_uid()) then
    missing := missing || 'public.profiles row for the bot';
  end if;
  if not exists (
    select 1 from public.user_roles
     where user_id = public.safety_bot_uid() and role = 'moderator'::public.app_role
  ) then
    missing := missing || 'moderator role for the bot';
  end if;

  if array_length(missing, 1) is null then
    raise notice 'SAFETY BOT: all good. Account, profile and moderator role are in place.';
  else
    raise warning 'SAFETY BOT INCOMPLETE: %', array_to_string(missing, ', ');
  end if;
end
$$;
