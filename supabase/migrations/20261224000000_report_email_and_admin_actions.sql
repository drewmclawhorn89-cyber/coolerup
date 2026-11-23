-- ===========================================================================
-- 20261224000000 · REPORT EMAIL & ADMIN REPORT ACTIONS
--
-- Extends `public.reports` with rich target/thumbnail/email delivery columns,
-- ensures all 5 report categories (spam, bullying/harassment, sexual, hate,
-- other + legacy categories) validate, adds service-role-only email config
-- (`report_email_config`), updates `admin_reports()` to return the new fields,
-- and adds admin RPCs for Delete Post, Warn User, and Ban User on a report.
--
-- Idempotent: safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Rich metadata & email status columns on public.reports
-- ---------------------------------------------------------------------------

alter table public.reports add column if not exists target_type text not null default 'video';
alter table public.reports add column if not exists comment_id uuid;
alter table public.reports add column if not exists target_url text;
alter table public.reports add column if not exists target_text text;
alter table public.reports add column if not exists thumbnail_url text;
alter table public.reports add column if not exists email_sent boolean not null default false;
alter table public.reports add column if not exists email_error text;
alter table public.reports add column if not exists emailed_at timestamptz;

alter table public.reports drop constraint if exists reports_reason_check;
alter table public.reports add constraint reports_reason_check
  check (reason in (
    'spam', 'bullying', 'harassment', 'sexual', 'hate', 'other',
    'violence', 'nudity', 'minor', 'illegal', 'scam'
  ));

create index if not exists reports_target_type_idx
  on public.reports (target_type, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. Service-role-only email transport config (optional fallback to env vars)
-- ---------------------------------------------------------------------------

create table if not exists public.report_email_config (
  id text primary key default 'default',
  provider text,
  resend_api_key text,
  sendgrid_api_key text,
  smtp_host text,
  smtp_port integer,
  smtp_user text,
  smtp_pass text,
  from_email text,
  webhook_url text,
  updated_at timestamptz not null default now()
);

revoke all on public.report_email_config from public, anon, authenticated;
grant all on public.report_email_config to service_role;
alter table public.report_email_config enable row level security;

-- ---------------------------------------------------------------------------
-- 3. admin_reports(): return full report context for Admin > Reports
-- ---------------------------------------------------------------------------

drop function if exists public.admin_reports(integer);

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
  target_type text,
  comment_id uuid,
  target_url text,
  target_text text,
  thumbnail_url text,
  email_sent boolean,
  email_error text,
  emailed_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select r.id,
         r.video_id,
         r.reported_video_id,
         r.reporter_username,
         r.reported_username,
         r.reported_user_id,
         r.reason,
         r.details,
         r.status,
         r.action_taken,
         r.target_type,
         r.comment_id,
         r.target_url,
         r.target_text,
         r.thumbnail_url,
         r.email_sent,
         r.email_error,
         r.emailed_at,
         r.created_at
  from public.reports r
  where public.has_role(auth.uid(), 'admin')
  order by r.created_at desc
  limit coalesce(_limit, 100)
$$;

revoke all on function public.admin_reports(integer) from public, anon;
grant execute on function public.admin_reports(integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. admin_delete_reported_post(): delete reported video or comment & resolve
-- ---------------------------------------------------------------------------

create or replace function public.admin_delete_reported_post(_report_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_actor text;
  v_row public.reports%rowtype;
  v_deleted_count integer := 0;
  v_rows integer := 0;
begin
  if not public.has_role(v_me, 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  select * into v_row from public.reports where id = _report_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Report not found');
  end if;

  select public.norm_handle(p.handle) into v_actor
    from public.profiles p where p.id = v_me limit 1;

  if v_row.target_type = 'comment' and v_row.comment_id is not null then
    delete from public.comments where id = v_row.comment_id;
    get diagnostics v_rows = row_count;
    v_deleted_count := v_deleted_count + v_rows;

    begin
      delete from public.full_video_comments where id = v_row.comment_id;
      get diagnostics v_rows = row_count;
      v_deleted_count := v_deleted_count + v_rows;
    exception when undefined_table then
      null;
    end;
  elsif v_row.video_id is not null then
    delete from public.videos where id = v_row.video_id;
    get diagnostics v_rows = row_count;
    v_deleted_count := v_deleted_count + v_rows;

    begin
      delete from public.full_videos where id = v_row.video_id;
      get diagnostics v_rows = row_count;
      v_deleted_count := v_deleted_count + v_rows;
    exception when undefined_table then
      null;
    end;
  else
    return jsonb_build_object('ok', false, 'error', 'No post attached to this report');
  end if;

  update public.reports
     set status = 'actioned',
         action_taken = 'post_deleted'
   where id = _report_id
      or (status = 'pending' and (
        (v_row.comment_id is not null and comment_id = v_row.comment_id)
        or (v_row.target_type <> 'comment' and v_row.video_id is not null and video_id = v_row.video_id)
      ));

  insert into public.moderation_log (
    user_id, username, action, reason, auto, actor, actor_id,
    content_type, content_id, content_excerpt
  )
  values (
    v_row.reported_user_id,
    v_row.reported_username,
    'admin_delete_post',
    coalesce(v_row.reason, 'Reported content removed by admin'),
    false,
    coalesce(v_actor, 'admin'),
    v_me,
    coalesce(v_row.target_type, 'video'),
    coalesce(v_row.comment_id, v_row.video_id),
    left(coalesce(v_row.target_text, v_row.details, ''), 280)
  );

  return jsonb_build_object('ok', true, 'deleted', v_deleted_count > 0);
end
$$;

revoke all on function public.admin_delete_reported_post(uuid) from public, anon;
grant execute on function public.admin_delete_reported_post(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. admin_warn_user(): issue a formal warning & notify the reported user
-- ---------------------------------------------------------------------------

create or replace function public.admin_warn_user(
  _report_id uuid,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_actor text;
  v_row public.reports%rowtype;
  v_target_uid uuid;
  v_handle text;
  v_reason text;
begin
  if not public.has_role(v_me, 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  select * into v_row from public.reports where id = _report_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Report not found');
  end if;

  v_handle := public.norm_handle(v_row.reported_username);
  v_target_uid := v_row.reported_user_id;
  if v_target_uid is null and v_handle <> '' then
    select p.id into v_target_uid from public.profiles p
     where public.norm_handle(p.handle) = v_handle limit 1;
  end if;

  select public.norm_handle(p.handle) into v_actor
    from public.profiles p where p.id = v_me limit 1;

  v_reason := coalesce(nullif(btrim(_reason), ''), 'Warning from moderation team: ' || coalesce(v_row.reason, 'rule violation'));

  if v_target_uid is not null then
    begin
      insert into public.user_strikes as us (
        user_id, username, strike_count, last_reason, last_kind,
        last_content_type, last_content_id, updated_at
      )
      values (
        v_target_uid, coalesce(nullif(v_handle, ''), 'unknown'), 1, v_reason,
        coalesce(v_row.reason, 'other'), coalesce(v_row.target_type, 'none'),
        coalesce(v_row.comment_id, v_row.video_id), now()
      )
      on conflict (user_id) do update
        set strike_count = least(public.user_strikes.strike_count + 1, 3),
            last_reason = excluded.last_reason,
            last_kind = excluded.last_kind,
            last_content_type = excluded.last_content_type,
            last_content_id = excluded.last_content_id,
            updated_at = now();
    exception when undefined_table then
      null;
    end;

    begin
      insert into public.notifications (target_user_id, actor_user_id, type, text, video_id)
      values (
        v_target_uid,
        v_me,
        'warning',
        v_reason,
        v_row.video_id
      );
    exception when undefined_table then
      null;
    end;
  end if;

  update public.reports
     set status = 'actioned',
         action_taken = 'warned'
   where id = _report_id;

  insert into public.moderation_log (
    user_id, username, action, reason, auto, actor, actor_id,
    content_type, content_id, content_excerpt
  )
  values (
    v_target_uid,
    coalesce(nullif(v_handle, ''), v_row.reported_username),
    'warn',
    v_reason,
    false,
    coalesce(v_actor, 'admin'),
    v_me,
    coalesce(v_row.target_type, 'none'),
    coalesce(v_row.comment_id, v_row.video_id),
    left(coalesce(v_row.target_text, v_row.details, ''), 280)
  );

  return jsonb_build_object('ok', true, 'username', v_handle);
end
$$;

revoke all on function public.admin_warn_user(uuid, text) from public, anon;
grant execute on function public.admin_warn_user(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. admin_ban_for_report(): ban reported user & mark report actioned
-- ---------------------------------------------------------------------------

create or replace function public.admin_ban_for_report(
  _report_id uuid,
  _hours integer default null,
  _permanent boolean default true,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_row public.reports%rowtype;
  v_res jsonb;
  v_reason text;
begin
  if not public.has_role(v_me, 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  select * into v_row from public.reports where id = _report_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'Report not found');
  end if;

  v_reason := coalesce(nullif(btrim(_reason), ''), 'Report: ' || coalesce(v_row.reason, 'rule violation'));
  v_res := public.admin_ban(v_row.reported_username, _hours, _permanent, v_reason);

  if coalesce((v_res->>'ok')::boolean, false) then
    update public.reports
       set status = 'actioned',
           action_taken = 'banned'
     where id = _report_id;
  end if;

  return v_res;
end
$$;

revoke all on function public.admin_ban_for_report(uuid, integer, boolean, text) from public, anon;
grant execute on function public.admin_ban_for_report(uuid, integer, boolean, text) to authenticated, service_role;
