-- ============================================================================
-- Remove the AI Bots Auto-Ban system from Coolerup.
--
-- What this migration does
--   1. Drops every safety-guard trigger that watched videos, comments,
--      messages and profiles on write.
--   2. Drops the classifier / ladder / sweep / bot-log functions.
--   3. Deletes the "Coolerup Safety Bot" account (profile, role, auth user).
--   4. Rewrites report_content() so a report is only ever recorded and
--      emailed to the owner. No auto-hide, no auto-ban, no strike.
--   5. Clears any strikes, identity bans and device records left behind, and
--      un-hides anything the bot had hidden.
--
-- Manual moderation is untouched: Admin > Reports, admin bans, dismissals and
-- the owner's unban button all keep working. Everything here is idempotent.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Safety-guard triggers
-- ---------------------------------------------------------------------------
drop trigger if exists videos_safety_guard on public.videos;
drop trigger if exists videos_safety_guard_update on public.videos;
drop trigger if exists comments_safety_guard on public.comments;
drop trigger if exists messages_safety_guard on public.messages;
drop trigger if exists profiles_safety_guard on public.profiles;
drop trigger if exists profiles_safety_guard_insert on public.profiles;

-- ---------------------------------------------------------------------------
-- 2. Bot functions. Dropped with no CASCADE on purpose: if something still
--    depends on them the migration fails loudly instead of silently removing
--    a function the app needs.
-- ---------------------------------------------------------------------------
drop function if exists public.safety_guard_video();
drop function if exists public.safety_guard_comment();
drop function if exists public.safety_guard_message();
drop function if exists public.safety_guard_profile();
drop function if exists public.safety_classify(text, text, text, text);
drop function if exists public.safety_normalize(text);
drop function if exists public.safety_reason(text);
drop function if exists public.safety_log(text, text, text, text, uuid, text, uuid, text, integer);
drop function if exists public.contains_banned_word(text);
drop function if exists public.auto_moderate(text, text, text, text, uuid, text, text);
drop function if exists public.bot_takedown(text, text, text, text, uuid);
drop function if exists public.safety_bot_sweep();
drop function if exists public.purge_hidden_videos();
drop function if exists public.admin_bot_logs(integer);
drop function if exists public.admin_ban_list();
drop function if exists public.my_strike_status();
drop function if exists public.admin_warn_user(uuid, text, text);

-- The bot identity helpers are only meaningful while the account exists.
drop function if exists public.is_safety_bot_uid(uuid);
drop function if exists public.safety_bot_uid();

-- ---------------------------------------------------------------------------
-- 3. Delete the Coolerup Safety Bot account
-- ---------------------------------------------------------------------------
do $$
declare
  v_bot uuid;
  v_handle text := 'coolerup_safety';
begin
  -- Find the bot by its well-known UID first, then by handle.
  select p.id into v_bot
    from public.profiles p
   where p.id = '00000000-0000-4000-8000-0000000005af'
   limit 1;

  if v_bot is null then
    select p.id into v_bot
      from public.profiles p
     where lower(btrim(coalesce(p.handle, ''))) = v_handle
     limit 1;
  end if;

  if v_bot is not null then
    delete from public.user_roles where user_id = v_bot;
    delete from public.profiles where id = v_bot;
  end if;

  -- Remove the auth user too so the handle cannot be signed into again.
  begin
    delete from auth.users where id = v_bot;
  exception when others then
    -- auth schema may be read-only in some environments; the profile is gone
    -- either way, which is what the app reads.
    null;
  end;

  -- Belt and braces: a profile row created under the handle with another id.
  delete from public.user_roles
   where user_id in (
     select p.id from public.profiles p
      where lower(btrim(coalesce(p.handle, ''))) = v_handle
   );

  delete from public.profiles
   where lower(btrim(coalesce(handle, ''))) = v_handle;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. report_content(): record the report only. The owner reviews manually.
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

  -- That is all. Reports never hide, warn or ban anything; they show up in
  -- Admin > Reports and are emailed to the owner for a manual decision.
  return jsonb_build_object('ok', true, 'banned', false, 'hidden', false);
end;
$$;

grant execute on function public.report_content(uuid, text, text, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Clear leftovers from the old ladder
-- ---------------------------------------------------------------------------
-- Un-hide anything the Safety Bot hid, so the owner can review it normally.
update public.videos
   set hidden = false,
       hidden_reason = null
 where hidden = true
   and coalesce(hidden_reason, '') ilike '%Safety Bot%';

-- No strikes, no device burns, no identity bans.
delete from public.user_strikes;
delete from public.user_devices;
delete from public.identity_bans;

-- ---------------------------------------------------------------------------
-- 6. Make sure the owner is never banned by a leftover row
-- ---------------------------------------------------------------------------
delete from public.banned_users
 where lower(btrim(username)) in ('drewmclawhorn3', '@drewmclawhorn3');
