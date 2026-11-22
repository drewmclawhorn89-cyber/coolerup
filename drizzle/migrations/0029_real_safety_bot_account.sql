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
begin
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
        '00000000-0000-0000-0000-000000000000',
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
      raise notice 'safety bot auth user insert skipped: %', sqlerrm;
    end;
  end if;

  -- auth.identities keeps GoTrue happy if it ever looks the account up.
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
      raise notice 'safety bot identity insert skipped: %', sqlerrm;
    end;
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
