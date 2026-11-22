-- ===========================================================================
-- COOLERUP · SAFETY BOT DIAGNOSTIC  (safe, cannot abort)
--
-- Paste this whole file into the Supabase SQL Editor and run it.
-- It prints a table telling us exactly which step of the bot-account setup is
-- blocked, so we can fix the real problem instead of guessing.
--
-- Send me the output of the last SELECT (the _diag table).
-- ===========================================================================

drop table if exists _diag;
create temp table _diag (step text, ok boolean, detail text);

do $$
declare
  v_uid   uuid := '00000000-0000-4000-8000-0000000005af';
  v_email text := 'safety-bot@coolerup.app';
  v_msg   text;
  v_cnt   integer;
  v_instance uuid;
begin
  -- Use the project's real auth instance id when one exists, otherwise the
  -- zero uuid. A wrong instance_id is a classic cause of a rejected insert.
  select coalesce((select id from auth.instances order by id limit 1),
                  '00000000-0000-0000-0000-000000000000'::uuid)
    into v_instance;

  -- ---------------------------------------------------------------- 0. env
  insert into _diag values ('00 current_user', true, current_user);
  insert into _diag values ('01 database', true, current_database());

  -- ------------------------------------------------- 1. schema / privileges
  insert into _diag
  select '02 can use auth schema', has_schema_privilege('auth', 'USAGE'), null;

  insert into _diag
  select '03 can insert auth.users',
         coalesce(has_table_privilege('auth.users', 'INSERT'), false), null;

  insert into _diag
  select '04 can insert auth.identities',
         coalesce(has_table_privilege('auth.identities', 'INSERT'), false), null;

  insert into _diag
  select '05 can insert public.profiles',
         coalesce(has_table_privilege('public.profiles', 'INSERT'), false), null;

  insert into _diag
  select '06 can insert public.user_roles',
         coalesce(has_table_privilege('public.user_roles', 'INSERT'), false), null;

  -- ------------------------------------------------------- 2. tables exist
  insert into _diag
  select '07 table public.user_strikes', to_regclass('public.user_strikes') is not null, null;
  insert into _diag
  select '08 table public.identity_bans', to_regclass('public.identity_bans') is not null, null;
  insert into _diag
  select '09 table public.user_devices', to_regclass('public.user_devices') is not null, null;
  insert into _diag
  select '10 table public.moderation_log', to_regclass('public.moderation_log') is not null, null;
  insert into _diag
  select '11 table public.banned_users', to_regclass('public.banned_users') is not null, null;
  insert into _diag
  select '12 table public.profiles', to_regclass('public.profiles') is not null, null;

  -- ------------------------------------------------------ 3. functions exist
  insert into _diag
  select '13 fn has_role', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'has_role'), null;
  insert into _diag
  select '14 fn is_owner', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_owner'), null;
  insert into _diag
  select '15 fn is_owner_uid', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'is_owner_uid'), null;
  insert into _diag
  select '16 fn ban_identity', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'ban_identity'), null;
  insert into _diag
  select '17 fn auto_moderate', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'auto_moderate'), null;
  insert into _diag
  select '18 fn safety_bot_uid', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'safety_bot_uid'), null;
  insert into _diag
  select '19 fn bot_takedown', exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = 'bot_takedown'), null;

  -- ------------------------------------------------- 4. current bot state
  insert into _diag
  select '20 bot auth.users row', exists (select 1 from auth.users where id = v_uid), null;

  insert into _diag
  select '21 bot auth.identities row', exists (select 1 from auth.identities where user_id = v_uid), null;

  insert into _diag
  select '22 bot profiles row', exists (select 1 from public.profiles where id = v_uid), null;

  insert into _diag
  select '23 bot user_roles row', exists (select 1 from public.user_roles where user_id = v_uid), null;

  insert into _diag
  select '24 handle taken by someone else',
         exists (select 1 from public.profiles
                 where lower(btrim(handle)) = 'coolerup_safety' and id <> v_uid),
         (select string_agg(id::text || ' / ' || handle, ', ')
            from public.profiles
           where lower(btrim(handle)) = 'coolerup_safety' and id <> v_uid);

  insert into _diag
  select '25 email already used in auth.users',
         exists (select 1 from auth.users where lower(email) = lower(v_email)),
         (select id::text from auth.users where lower(email) = lower(v_email) limit 1);

  -- --------------------------------- 5. moderation_log / banned_users shape
  insert into _diag
  select '26 moderation_log has actor_id',
         exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'moderation_log'
                   and column_name = 'actor_id'), null;

  insert into _diag
  select '27 moderation_log columns',
         true,
         (select string_agg(column_name, ', ' order by ordinal_position)
            from information_schema.columns
           where table_schema = 'public' and table_name = 'moderation_log');

  insert into _diag
  select '28 banned_users columns',
         true,
         (select string_agg(column_name, ', ' order by ordinal_position)
            from information_schema.columns
           where table_schema = 'public' and table_name = 'banned_users');

  insert into _diag
  select '29 profiles columns',
         true,
         (select string_agg(column_name || ':' || data_type, ', ' order by ordinal_position)
            from information_schema.columns
           where table_schema = 'public' and table_name = 'profiles');

  insert into _diag
  select '30 user_roles role values',
         true,
         (select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
            from pg_enum e join pg_type t on t.oid = e.enumtypid
           where t.typname = 'app_role');

  insert into _diag
  select '30a auth.instances rows',
         true,
         (select count(*)::text from auth.instances);

  insert into _diag
  select '30b triggers on auth.users',
         true,
         coalesce((select string_agg(t.tgname, ', ' order by t.tgname)
                     from pg_trigger t
                     join pg_class c on c.oid = t.tgrelid
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'auth' and c.relname = 'users'
                      and not t.tgisinternal), '(none)');

  insert into _diag
  select '30c triggers on public.profiles',
         true,
         coalesce((select string_agg(t.tgname, ', ' order by t.tgname)
                     from pg_trigger t
                     join pg_class c on c.oid = t.tgrelid
                     join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'public' and c.relname = 'profiles'
                      and not t.tgisinternal), '(none)');

  insert into _diag
  select '30d auth.users required cols w/o default',
         true,
         coalesce((select string_agg(column_name, ', ' order by ordinal_position)
                     from information_schema.columns
                    where table_schema = 'auth' and table_name = 'users'
                      and is_nullable = 'NO' and column_default is null), '(none)');

  -- ------------------------------------------- 6. the real test: can we insert?
  -- This is the step that was silently failing. We try it and record the exact
  -- error text instead of swallowing it.
  begin
    if exists (select 1 from auth.users where id = v_uid) then
      insert into _diag values ('31 auth.users insert', true, 'already exists, skipped');
    else
      insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, created_at, updated_at,
        raw_app_meta_data, raw_user_meta_data,
        confirmation_token, recovery_token,
        email_change_token_new, email_change
      ) values (
        v_instance, v_uid, 'authenticated', 'authenticated',
        v_email, '$2a$10$UAuLYr7cEqBmgFOwAgLc8uYoOGXs3MIcEs4HFzq.eQaNRUycES1hG',
        now(), now(), now(),
        jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email'), 'coolerup_bot', true),
        jsonb_build_object('coolerup_bot', true, 'handle', 'coolerup_safety'),
        '', '', '', ''
      );
      insert into _diag values ('31 auth.users insert', true, 'SUCCEEDED');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into _diag values ('31 auth.users insert', false, sqlstate || ' - ' || v_msg);
  end;

  begin
    if exists (select 1 from auth.users where id = v_uid)
       and not exists (select 1 from auth.identities where user_id = v_uid) then
      insert into auth.identities (
        provider_id, user_id, identity_data, provider,
        last_sign_in_at, created_at, updated_at
      ) values (
        v_uid::text, v_uid,
        jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
        'email', now(), now(), now()
      );
      insert into _diag values ('32 auth.identities insert', true, 'SUCCEEDED');
    else
      insert into _diag values ('32 auth.identities insert', true, 'not needed');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into _diag values ('32 auth.identities insert', false, sqlstate || ' - ' || v_msg);
  end;

  begin
    if exists (select 1 from auth.users where id = v_uid) then
      insert into public.profiles (id, handle, display_name, bio, avatar_url)
      values (
        v_uid, 'coolerup_safety', 'Coolerup Safety Bot',
        'I watch new videos, comments, messages, bios and profile pictures 24/7. I remove content that breaks the rules and apply the 3-strike ladder. I never flag you for reposting someone else''s video.',
        '/safety-bot.png'
      )
      on conflict (id) do update
        set handle = excluded.handle,
            display_name = excluded.display_name,
            bio = excluded.bio,
            avatar_url = excluded.avatar_url;
      insert into _diag values ('33 profiles insert', true, 'SUCCEEDED');
    else
      insert into _diag values ('33 profiles insert', false, 'skipped: no auth.users row');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into _diag values ('33 profiles insert', false, sqlstate || ' - ' || v_msg);
  end;

  begin
    if exists (select 1 from public.profiles where id = v_uid) then
      insert into public.user_roles (user_id, role)
      values (v_uid, 'moderator'::public.app_role)
      on conflict (user_id, role) do nothing;
      insert into _diag values ('34 user_roles insert', true, 'SUCCEEDED');
    else
      insert into _diag values ('34 user_roles insert', false, 'skipped: no profiles row');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into _diag values ('34 user_roles insert', false, sqlstate || ' - ' || v_msg);
  end;

  begin
    alter table public.moderation_log add column if not exists actor_id uuid;
    insert into _diag values ('35 moderation_log.actor_id', true, 'SUCCEEDED');
  exception when others then
    get stacked diagnostics v_msg = message_text;
    insert into _diag values ('35 moderation_log.actor_id', false, sqlstate || ' - ' || v_msg);
  end;

  -- ------------------------------------------------------------- 7. summary
  select count(*) into v_cnt from _diag where ok = false;
  insert into _diag
  values ('99 SUMMARY', v_cnt = 0, v_cnt || ' step(s) failed');
end
$$;

-- ============================ THE REPORT ==================================
select step, ok, detail from _diag order by step;
