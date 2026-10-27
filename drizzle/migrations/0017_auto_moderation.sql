-- 0017_auto_moderation.sql
--
-- TikTok-style auto moderation. Everything that decides a ban lives in the
-- database, because `reports` is admin-read-only and `banned_users` is
-- admin-write-only under RLS — a client-side "count the reports" check would
-- always see zero and never ban anyone.
--
-- AUTO-BANS ARE OFF.
--
-- Reports are still recorded and still listed in /admin, but nothing bans or
-- mutes anybody automatically. A human decides, using the buttons in /admin.
--
-- What still happens automatically:
--   banned words in a caption -> that one video is hidden + logged
--
-- What was removed:
--   3 reports / 24h, 5 reports / 7d, 10 reports total  -> no auto-ban
--   5 identical comments -> no auto-mute
--   5 videos in 10 min   -> no auto-ban
--
-- Idempotent: safe to run more than once. Re-running this file removes the
-- old auto-ban and auto-mute triggers from a database that already has them.

-- ---------------------------------------------------------------------------
-- 1. Banned words
-- ---------------------------------------------------------------------------

create table if not exists public.banned_words (
  id uuid primary key default gen_random_uuid(),
  word text not null unique,
  severity text not null default 'warn' check (severity in ('warn', 'hide', 'block')),
  created_at timestamptz not null default now()
);

grant select on public.banned_words to anon, authenticated;
grant all on public.banned_words to service_role;
alter table public.banned_words enable row level security;

drop policy if exists "banned words readable" on public.banned_words;
create policy "banned words readable" on public.banned_words
  for select to anon, authenticated using (true);

drop policy if exists "admins manage banned words" on public.banned_words;
create policy "admins manage banned words" on public.banned_words
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

insert into public.banned_words (word, severity) values
  ('spam', 'hide'),
  ('scam', 'hide'),
  ('free money', 'hide'),
  ('cashapp me', 'hide'),
  ('crypto giveaway', 'hide'),
  ('double your money', 'hide'),
  ('buy followers', 'hide'),
  ('click my link', 'hide'),
  ('dm for promo', 'hide'),
  ('telegram me', 'hide'),
  ('fuck', 'hide'),
  ('fucking', 'hide'),
  ('shit', 'hide'),
  ('bullshit', 'hide'),
  ('bitch', 'hide'),
  ('asshole', 'hide'),
  ('cunt', 'hide'),
  ('nigger', 'block'),
  ('nigga', 'block'),
  ('faggot', 'block'),
  ('retard', 'block'),
  ('kys', 'block'),
  ('kill yourself', 'block'),
  ('hate', 'warn'),
  ('kill', 'warn')
on conflict (word) do nothing;

-- Normalized "does this text contain a banned word" check. Mirrors the client
-- filter in src/lib/moderation.ts (leetspeak + punctuation stripping) so the
-- two can't disagree.
create or replace function public.contains_banned_word(_text text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with normalized as (
    select ' ' || regexp_replace(
             regexp_replace(
               regexp_replace(lower(coalesce(_text, '')), '[^a-z0-9]', ' ', 'g'),
               '[0@]', 'o', 'g'
             ),
             '\s+', ' ', 'g'
           ) || ' ' as t
  )
  select exists (
    select 1
    from public.banned_words w, normalized n
    where n.t like '% ' || lower(w.word) || ' %'
  )
$$;

grant execute on function public.contains_banned_word(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Reports: add the columns the moderation engine needs
-- ---------------------------------------------------------------------------

alter table public.reports add column if not exists video_id uuid;
alter table public.reports add column if not exists reported_user_id uuid;
alter table public.reports add column if not exists auto_actioned boolean not null default false;
alter table public.reports add column if not exists action_taken text;

-- Widen the reason list to TikTok's categories (keeps the old ones so existing
-- rows still validate).
alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in (
    'violence', 'hate', 'nudity', 'spam', 'harassment',
    'minor', 'illegal', 'scam', 'other'
  ));

create index if not exists reports_reported_user_idx
  on public.reports (reported_user_id, created_at desc);
create index if not exists reports_reported_username_idx
  on public.reports (reported_username, created_at desc);
create index if not exists reports_status_idx
  on public.reports (status, created_at desc);

-- Backfill reported_user_id from the handle for existing rows.
update public.reports r
   set reported_user_id = p.id
  from public.profiles p
 where r.reported_user_id is null
   and public.norm_handle(p.handle) = public.norm_handle(r.reported_username);

-- ---------------------------------------------------------------------------
-- 3. banned_users: user_id, kind (ban vs mute), auto flag, created_at
-- ---------------------------------------------------------------------------

alter table public.banned_users add column if not exists user_id uuid;
alter table public.banned_users add column if not exists created_at timestamptz not null default now();
alter table public.banned_users add column if not exists kind text not null default 'ban';
alter table public.banned_users add column if not exists auto boolean not null default false;
alter table public.banned_users add column if not exists report_count integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.banned_users'::regclass
      and conname = 'banned_users_kind_check'
  ) then
    alter table public.banned_users
      add constraint banned_users_kind_check check (kind in ('ban', 'mute'));
  end if;
end
$$;

-- Backfill user_id for existing bans.
update public.banned_users b
   set user_id = p.id
  from public.profiles p
 where b.user_id is null
   and public.norm_handle(p.handle) = public.norm_handle(b.username);

create index if not exists banned_users_user_idx on public.banned_users (user_id);
create index if not exists banned_users_expires_idx on public.banned_users (expires_at);

-- ---------------------------------------------------------------------------
-- 4. Moderation log (the "auto-ban log" in the admin panel)
-- ---------------------------------------------------------------------------

create table if not exists public.moderation_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  username text,
  action text not null,
  reason text,
  report_count integer,
  window_hours integer,
  is_permanent boolean not null default false,
  expires_at timestamptz,
  auto boolean not null default true,
  actor text,
  created_at timestamptz not null default now()
);

grant select on public.moderation_log to authenticated;
grant all on public.moderation_log to service_role;
alter table public.moderation_log enable row level security;

drop policy if exists "admins read moderation log" on public.moderation_log;
create policy "admins read moderation log" on public.moderation_log
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create index if not exists moderation_log_created_idx
  on public.moderation_log (created_at desc);

-- ---------------------------------------------------------------------------
-- 5. videos.hidden — set when a caption trips the word filter
-- ---------------------------------------------------------------------------

alter table public.videos add column if not exists hidden boolean not null default false;
alter table public.videos add column if not exists hidden_reason text;
alter table public.videos add column if not exists user_id uuid;

update public.videos v
   set user_id = p.id
  from public.profiles p
 where v.user_id is null
   and public.norm_handle(p.handle) = public.norm_handle(v.username);

create index if not exists videos_hidden_idx on public.videos (hidden);
create index if not exists videos_username_created_idx on public.videos (username, created_at desc);

-- Banned authors and hidden videos disappear from every feed, for everyone.
-- RESTRICTIVE => AND-ed with the existing "videos readable" policy, so this can
-- only ever remove visibility, never grant it.
drop policy if exists "hide moderated videos" on public.videos;
create policy "hide moderated videos" on public.videos
  as restrictive for select to anon, authenticated
  using (not hidden and not public.is_banned(username));

-- ---------------------------------------------------------------------------
-- 6. Core ban/mute writer
-- ---------------------------------------------------------------------------

create or replace function public.apply_moderation(
  _user_id uuid,
  _username text,
  _action text,
  _reason text,
  _hours integer default null,
  _permanent boolean default false,
  _kind text default 'ban',
  _auto boolean default true,
  _actor text default 'auto-moderation',
  _report_count integer default null,
  _window_hours integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text := public.norm_handle(_username);
  expires timestamptz;
  uid uuid := _user_id;
begin
  if handle is null or handle = '' then
    return jsonb_build_object('applied', false, 'error', 'missing handle');
  end if;

  if uid is null then
    select p.id into uid from public.profiles p
     where public.norm_handle(p.handle) = handle
     limit 1;
  end if;

  if not _permanent and _hours is not null then
    expires := now() + make_interval(hours => _hours);
  end if;

  insert into public.banned_users as b (
    username, user_id, reason, banned_by, is_permanent, expires_at,
    kind, auto, report_count, created_at
  )
  values (
    handle, uid, _reason, coalesce(_actor, 'auto-moderation'), _permanent, expires,
    _kind, _auto, _report_count, now()
  )
  on conflict (username) do update set
    user_id      = coalesce(excluded.user_id, b.user_id),
    reason       = excluded.reason,
    banned_by    = excluded.banned_by,
    is_permanent = b.is_permanent or excluded.is_permanent,
    expires_at   = case
                     when b.is_permanent then null
                     when excluded.is_permanent then null
                     else greatest(coalesce(b.expires_at, now()), coalesce(excluded.expires_at, now()))
                   end,
    kind         = excluded.kind,
    auto         = excluded.auto,
    report_count = coalesce(excluded.report_count, b.report_count),
    created_at   = now();

  insert into public.moderation_log (
    user_id, username, action, reason, report_count, window_hours,
    is_permanent, expires_at, auto, actor
  )
  values (
    uid, handle, _action, _reason, _report_count, _window_hours,
    _permanent, expires, _auto, coalesce(_actor, 'auto-moderation')
  );

  return jsonb_build_object(
    'applied', true,
    'username', handle,
    'action', _action,
    'kind', _kind,
    'is_permanent', _permanent,
    'expires_at', expires,
    'report_count', _report_count
  );
end
$$;

-- Internal only: reachable through report_content(), the triggers and the
-- admin RPCs, all of which are SECURITY DEFINER. Never granted to clients,
-- otherwise anyone could ban anyone.
revoke all on function public.apply_moderation(uuid, text, text, text, integer, boolean, text, boolean, text, integer, integer) from public, anon, authenticated;
grant execute on function public.apply_moderation(uuid, text, text, text, integer, boolean, text, boolean, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 7. Threshold evaluation  (DISABLED — reports no longer auto-ban)
-- ---------------------------------------------------------------------------
-- Auto-bans are turned OFF. This function is kept only so existing callers
-- (report_content) and the client wrapper do not break; it always reports
-- "nothing applied". Reports are still recorded and still show up in /admin,
-- where a human decides what to do.

create or replace function public.auto_ban_if_needed(_user_id uuid, _username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('applied', false, 'disabled', true);
end
$$;

grant execute on function public.auto_ban_if_needed(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 8. Report submission (one call: insert report + evaluate thresholds)
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
  me uuid := auth.uid();
  my_handle text;
  target_handle text := public.norm_handle(_reported_username);
  target_id uuid;
  result jsonb;
  dup boolean;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in to report');
  end if;

  select public.norm_handle(p.handle) into my_handle
    from public.profiles p where p.id = me limit 1;

  if target_handle is null or target_handle = '' then
    return jsonb_build_object('ok', false, 'error', 'Unknown user');
  end if;

  if my_handle = target_handle then
    return jsonb_build_object('ok', false, 'error', "You can't report yourself");
  end if;

  if _reason not in ('violence','hate','nudity','spam','harassment','minor','illegal','scam','other') then
    return jsonb_build_object('ok', false, 'error', 'Invalid reason');
  end if;

  select p.id into target_id from public.profiles p
   where public.norm_handle(p.handle) = target_handle limit 1;

  -- One report per user per video per reason, so a single person can't
  -- trigger the 3-report threshold on their own.
  select exists (
    select 1 from public.reports r
    where r.reporter_id = me
      and public.norm_handle(r.reported_username) = target_handle
      and r.reason = _reason
      and (r.video_id is not distinct from _video_id)
      and r.created_at >= now() - interval '7 days'
  ) into dup;

  if dup then
    return jsonb_build_object('ok', true, 'duplicate', true, 'banned', false);
  end if;

  insert into public.reports (
    reporter_id, reporter_username, reported_username, reported_user_id,
    reported_video_id, video_id, reason, details, status
  )
  values (
    me, coalesce(my_handle, 'unknown'), target_handle, target_id,
    _video_id::text, _video_id, _reason, nullif(btrim(coalesce(_details, '')), ''), 'pending'
  );

  result := public.auto_ban_if_needed(target_id, target_handle);

  if (result ->> 'applied')::boolean then
    update public.reports r
       set auto_actioned = true,
           action_taken = result ->> 'action',
           status = 'actioned'
     where r.reporter_id = me
       and public.norm_handle(r.reported_username) = target_handle
       and r.status = 'pending';
  end if;

  return jsonb_build_object(
    'ok', true,
    'banned', coalesce((result ->> 'applied')::boolean, false),
    'action', result ->> 'action',
    'expires_at', result ->> 'expires_at'
  );
end
$$;

grant execute on function public.report_content(uuid, text, text, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Caption filter trigger (hides videos containing banned words)
-- ---------------------------------------------------------------------------

create or replace function public.moderate_new_video()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text := public.norm_handle(new.username);
  words text;
begin
  -- Caption filter: hide the video and log a warning. Never blocks the upload.
  if public.contains_banned_word(new.caption) then
    select string_agg(w.word, ', ') into words
      from public.banned_words w
     where public.contains_banned_word(new.caption)
       and (' ' || lower(new.caption) || ' ') like '%' || lower(w.word) || '%';

    new.hidden := true;
    new.hidden_reason := 'Banned words in caption';

    insert into public.moderation_log (
      user_id, username, action, reason, auto, actor
    )
    values (
      new.user_id, handle, 'video_hidden',
      format('Caption contained banned words%s', coalesce(': ' || words, '')),
      true, 'auto-moderation'
    );
  end if;

  return new;
end
$$;

drop trigger if exists videos_moderate_insert on public.videos;
create trigger videos_moderate_insert
  before insert on public.videos
  for each row execute function public.moderate_new_video();

-- ---------------------------------------------------------------------------
-- 10. Comment spam mute  (DISABLED — no automatic mutes)
-- ---------------------------------------------------------------------------
-- The "5 identical comments -> 1 hour mute" rule is turned off. The trigger is
-- dropped so nothing fires on insert. Duplicate comments are now just left for
-- a human to look at in /admin.

drop trigger if exists comments_moderate_insert on public.comments;

-- ---------------------------------------------------------------------------
-- 11. Mute lookup
-- ---------------------------------------------------------------------------

create or replace function public.is_muted(_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.banned_users b
    where public.norm_handle(b.username) = public.norm_handle(_username)
      and b.kind = 'mute'
      and (b.is_permanent or b.expires_at is null or b.expires_at > now())
  )
$$;

grant execute on function public.is_muted(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 12. Admin panel RPCs
-- ---------------------------------------------------------------------------

create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin')
$$;

grant execute on function public.am_i_admin() to authenticated, service_role;

create or replace function public.admin_reports(_limit integer default 100)
returns table (
  id uuid,
  video_id uuid,
  reported_video_id text,
  reporter_username text,
  reported_username text,
  reported_user_id uuid,
  reason text,
  details text,
  status text,
  action_taken text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id, r.video_id, r.reported_video_id, r.reporter_username,
         r.reported_username, r.reported_user_id, r.reason, r.details,
         r.status, r.action_taken, r.created_at
  from public.reports r
  where public.has_role(auth.uid(), 'admin')
  order by r.created_at desc
  limit coalesce(_limit, 100)
$$;

grant execute on function public.admin_reports(integer) to authenticated, service_role;

create or replace function public.admin_bans()
returns table (
  id uuid,
  username text,
  user_id uuid,
  reason text,
  banned_by text,
  kind text,
  is_permanent boolean,
  expires_at timestamptz,
  auto boolean,
  report_count integer,
  created_at timestamptz,
  active boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id, b.username, b.user_id, b.reason, b.banned_by, b.kind,
         b.is_permanent, b.expires_at, b.auto, b.report_count, b.created_at,
         (b.is_permanent or b.expires_at is null or b.expires_at > now()) as active
  from public.banned_users b
  where public.has_role(auth.uid(), 'admin')
  order by b.created_at desc
$$;

grant execute on function public.admin_bans() to authenticated, service_role;

create or replace function public.admin_moderation_log(_limit integer default 100)
returns table (
  id uuid,
  username text,
  action text,
  reason text,
  report_count integer,
  is_permanent boolean,
  expires_at timestamptz,
  auto boolean,
  actor text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.username, l.action, l.reason, l.report_count,
         l.is_permanent, l.expires_at, l.auto, l.actor, l.created_at
  from public.moderation_log l
  where public.has_role(auth.uid(), 'admin')
  order by l.created_at desc
  limit coalesce(_limit, 100)
$$;

grant execute on function public.admin_moderation_log(integer) to authenticated, service_role;

create or replace function public.admin_ban(
  _username text,
  _hours integer default null,
  _permanent boolean default false,
  _reason text default 'Manual ban by admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  my_handle text;
begin
  if not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  select public.norm_handle(p.handle) into my_handle
    from public.profiles p where p.id = auth.uid() limit 1;

  return public.apply_moderation(
    null, _username,
    case when _permanent then 'admin_ban_permanent' else 'admin_ban' end,
    _reason, _hours, _permanent, 'ban', false,
    coalesce(my_handle, 'admin'), null, null
  );
end
$$;

grant execute on function public.admin_ban(text, integer, boolean, text) to authenticated, service_role;

create or replace function public.admin_unban(_username text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  handle text := public.norm_handle(_username);
  my_handle text;
begin
  if not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  delete from public.banned_users b
   where public.norm_handle(b.username) = handle;

  select public.norm_handle(p.handle) into my_handle
    from public.profiles p where p.id = auth.uid() limit 1;

  insert into public.moderation_log (username, action, reason, auto, actor)
  values (handle, 'admin_unban', 'Ban lifted by admin', false, coalesce(my_handle, 'admin'));

  return jsonb_build_object('ok', true, 'username', handle);
end
$$;

grant execute on function public.admin_unban(text) to authenticated, service_role;

create or replace function public.admin_dismiss_report(_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  update public.reports r
     set status = 'dismissed'
   where r.id = _report_id;

  return jsonb_build_object('ok', true);
end
$$;

grant execute on function public.admin_dismiss_report(uuid) to authenticated, service_role;

create or replace function public.admin_unhide_video(_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  update public.videos v
     set hidden = false, hidden_reason = null
   where v.id = _video_id;

  return jsonb_build_object('ok', true);
end
$$;

grant execute on function public.admin_unhide_video(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. Lift any bans that the old auto-ban rules already applied
-- ---------------------------------------------------------------------------
-- Only rows flagged auto = true are touched. Bans you set by hand (auto = false)
-- are left exactly as they are. The moderation_log keeps the history.

delete from public.banned_users where auto = true;

-- ---------------------------------------------------------------------------
-- 14. Refresh PostgREST's schema cache
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
