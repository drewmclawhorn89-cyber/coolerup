-- 0019_fix_comment_insert.sql
--
-- BUG: every comment insert failed with
--
--   ERROR 42702: column reference "handle" is ambiguous
--
-- so nobody could post a comment (or a reply, or a GIF comment). The app
-- surfaced it as "Couldn't post comment: column reference "handle" is
-- ambiguous".
--
-- Cause
-- -----
-- 0017_auto_moderation.sql created a BEFORE INSERT trigger on public.comments:
--
--   create trigger comments_moderate_insert
--     before insert on public.comments
--     for each row execute function public.moderate_new_comment();
--
-- and moderate_new_comment() declared a PL/pgSQL variable named `handle`
-- while also querying public.profiles, which has a column named `handle`:
--
--   handle text := public.norm_handle(new.username);
--   select p.id into uid
--     from public.profiles p
--    where public.norm_handle(p.handle) = handle   -- <-- ambiguous
--    limit 1;
--
-- Postgres cannot decide whether the bare `handle` in the WHERE clause is the
-- variable or p.handle, so it raises 42702 and the whole insert is rolled back.
--
-- The auto-mute that trigger implemented was disabled afterwards (auto-bans and
-- auto-mutes are off; a human decides in /admin), but the "disable" commit only
-- edited 0017 in place. 0017 had already been applied to the live database, so
-- the trigger kept firing and comments stayed broken.
--
-- Fix
-- ---
--   1. Drop the trigger and the broken function outright. Nothing should run on
--      comment insert: comment moderation is manual now.
--   2. Re-create apply_moderation() with prefixed variable names. It had the
--      same `where public.norm_handle(p.handle) = handle` bug, which broke
--      admin bans whenever the caller did not pass a user id.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Stop the broken comment trigger
-- ---------------------------------------------------------------------------

drop trigger if exists comments_moderate_insert on public.comments;
drop function if exists public.moderate_new_comment();

-- ---------------------------------------------------------------------------
-- 2. apply_moderation(): no ambiguous `handle`
-- ---------------------------------------------------------------------------
-- Same signature and behaviour as 0017; only the local variables are renamed
-- (v_handle / v_uid) so they can never collide with public.profiles.handle.

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
  v_handle text := public.norm_handle(_username);
  v_expires timestamptz;
  v_uid uuid := _user_id;
begin
  if v_handle is null or v_handle = '' then
    return jsonb_build_object('applied', false, 'error', 'missing handle');
  end if;

  if v_uid is null then
    select p.id into v_uid
      from public.profiles p
     where public.norm_handle(p.handle) = v_handle
     limit 1;
  end if;

  if not _permanent and _hours is not null then
    v_expires := now() + make_interval(hours => _hours);
  end if;

  insert into public.banned_users as b (
    username, user_id, reason, banned_by, is_permanent, expires_at,
    kind, auto, report_count, created_at
  )
  values (
    v_handle, v_uid, _reason, coalesce(_actor, 'auto-moderation'), _permanent, v_expires,
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
    v_uid, v_handle, _action, _reason, _report_count, _window_hours,
    _permanent, v_expires, _auto, coalesce(_actor, 'auto-moderation')
  );

  return jsonb_build_object(
    'applied', true,
    'username', v_handle,
    'action', _action,
    'kind', _kind,
    'is_permanent', _permanent,
    'expires_at', v_expires,
    'report_count', _report_count
  );
end
$$;

-- Internal only, exactly as before: reachable through the SECURITY DEFINER
-- callers, never directly from a client.
revoke all on function public.apply_moderation(uuid, text, text, text, integer, boolean, text, boolean, text, integer, integer) from public, anon, authenticated;
grant execute on function public.apply_moderation(uuid, text, text, text, integer, boolean, text, boolean, text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 3. Refresh PostgREST's schema cache
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
