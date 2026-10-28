-- 0021_remove_auto_ban.sql
--
-- AUTO-BANS ARE REMOVED ENTIRELY.
--
-- 0017_auto_moderation.sql tried to switch auto-bans off by editing itself in
-- place, but it had already been applied to the live database. Worse, the
-- "disabled" stub it left behind (auto_ban_if_needed) still contained the old
-- ambiguous `handle` reference:
--
--   ERROR 42702: column reference "handle" is ambiguous
--
-- so every call to report_content() blew up and nobody could file a report at
-- all. This migration deletes the auto-ban path instead of leaving a stub.
--
-- What changes:
--   * auto_ban_if_needed() is DROPPED (function no longer exists).
--   * report_content() is rewritten: it records the report and returns. It
--     never evaluates thresholds and never bans anyone.
--   * Any ban row previously created by automation (auto = true) is lifted.
--     Manual admin bans (auto = false) are untouched.
--
-- What stays:
--   * Reports are still stored and still listed in /admin.
--   * Banned-word caption filter still hides that one video + logs it.
--   * Admins can still ban / unban / dismiss by hand.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Remove the auto-ban entry point
-- ---------------------------------------------------------------------------

drop function if exists public.auto_ban_if_needed(uuid, text);

-- ---------------------------------------------------------------------------
-- 2. report_content(): record only, no thresholds, no bans
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

  if _reason not in ('violence','hate','nudity','spam','harassment','minor','illegal','scam','other') then
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
    return jsonb_build_object('ok', true, 'duplicate', true, 'banned', false);
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

  -- No threshold evaluation. A human reviews this in /admin.
  return jsonb_build_object('ok', true, 'banned', false);
end
$$;

grant execute on function public.report_content(uuid, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Lift every ban that automation applied
-- ---------------------------------------------------------------------------

delete from public.banned_users where auto = true;

-- ---------------------------------------------------------------------------
-- 4. Refresh PostgREST's schema cache
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
