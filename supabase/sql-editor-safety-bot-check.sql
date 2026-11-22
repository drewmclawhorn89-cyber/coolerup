-- =====================================================================
-- COOLERUP · SAFETY BOT CHECK-UP
-- =====================================================================
-- Paste this into the Supabase SQL Editor and press Run.
-- It changes nothing permanent. It only looks, plus one throwaway test
-- row that it inserts and deletes immediately.
--
-- Send me the whole result table. It says exactly which piece is missing.
-- =====================================================================

drop table if exists _check;
create temp table _check (step text, result text, detail text);

-- ---------------------------------------------------------------------
-- 1. Are the columns there?
-- ---------------------------------------------------------------------
insert into _check
select 'column videos.hidden',
       case when exists (
         select 1 from information_schema.columns
          where table_schema='public' and table_name='videos' and column_name='hidden'
       ) then 'OK' else 'MISSING' end,
       coalesce((
         select data_type || ' default ' || coalesce(column_default,'none') ||
                ' nullable=' || is_nullable
           from information_schema.columns
          where table_schema='public' and table_name='videos' and column_name='hidden'
       ), 'no such column');

insert into _check
select 'column videos.hidden_reason',
       case when exists (
         select 1 from information_schema.columns
          where table_schema='public' and table_name='videos' and column_name='hidden_reason'
       ) then 'OK' else 'MISSING' end, '';

insert into _check
select 'column videos.user_id',
       case when exists (
         select 1 from information_schema.columns
          where table_schema='public' and table_name='videos' and column_name='user_id'
       ) then 'OK' else 'MISSING' end, '';

-- ---------------------------------------------------------------------
-- 2. Are the triggers actually attached to the tables?
--    (A function existing is not enough -- the trigger must be bound.)
-- ---------------------------------------------------------------------
insert into _check
select 'trigger ' || t.tgname,
       'OK',
       c.relname || ' ' ||
       case when (t.tgtype & 2) <> 0 then 'BEFORE' else 'AFTER' end || ' ' ||
       case when (t.tgtype & 4) <> 0 then 'INSERT ' else '' end ||
       case when (t.tgtype & 16) <> 0 then 'UPDATE ' else '' end ||
       case when (t.tgtype & 8) <> 0 then 'DELETE ' else '' end
  from pg_trigger t
  join pg_class c on c.oid = t.tgrelid
  join pg_namespace n on n.oid = c.relnamespace
 where not t.tgisinternal
   and n.nspname = 'public'
   and t.tgname in (
     'videos_safety_guard','videos_safety_guard_update','comments_safety_guard',
     'messages_safety_guard','profiles_safety_guard','profiles_safety_guard_insert'
   );

insert into _check
select 'trigger count',
       (select count(*)::text from pg_trigger t
          join pg_class c on c.oid=t.tgrelid
          join pg_namespace n on n.oid=c.relnamespace
         where not t.tgisinternal and n.nspname='public'
           and t.tgname in ('videos_safety_guard','videos_safety_guard_update',
             'comments_safety_guard','messages_safety_guard','profiles_safety_guard',
             'profiles_safety_guard_insert')) || ' of 6',
       'anything under 6 means part 3 did not finish';

-- ---------------------------------------------------------------------
-- 3. Do the functions exist?
-- ---------------------------------------------------------------------
insert into _check
select 'function ' || f,
       case when to_regprocedure('public.' || f) is null then 'MISSING' else 'OK' end, ''
  from unnest(array[
    'safety_classify(text,text)','safety_normalize(text)','safety_reason(text)',
    'safety_guard_video()','safety_guard_comment()','safety_guard_message()',
    'safety_guard_profile()','safety_bot_sweep()','purge_hidden_videos()',
    'auto_moderate(uuid,text,text,text,text,uuid)','bot_takedown(text,text,text,text,uuid)',
    'safety_bot_uid()','is_owner_uid(uuid)','report_content(uuid,text,text,text)'
  ]) as f;

-- ---------------------------------------------------------------------
-- 4. Is the bot account real?
-- ---------------------------------------------------------------------
-- Dynamic on purpose: if safety_bot_uid() or the app_role enum is missing,
-- a direct call would abort this whole script before it reports anything --
-- which is precisely when the check-up is most needed.
do $$
declare
  v_uid uuid;
  v_n bigint;
  v_txt text;
begin
  if to_regprocedure('public.safety_bot_uid()') is null then
    insert into _check values ('bot auth.users row', 'MISSING', 'safety_bot_uid() does not exist -- part 2 never ran');
    return;
  end if;

  execute 'select public.safety_bot_uid()' into v_uid;

  execute 'select count(*) from auth.users where id = $1' into v_n using v_uid;
  insert into _check values ('bot auth.users row', v_n::text, '');

  execute 'select count(*) from public.profiles where id = $1' into v_n using v_uid;
  insert into _check values ('bot profile row', v_n::text, '');

  execute 'select handle from public.profiles where id = $1' into v_txt using v_uid;
  insert into _check values ('bot handle', coalesce(v_txt,'none'), 'should be coolerup_safety');

  begin
    execute 'select count(*) from public.user_roles where user_id = $1 and role = ''moderator''::public.app_role'
      into v_n using v_uid;
    insert into _check values ('bot moderator role', v_n::text, '');
  exception when others then
    insert into _check values ('bot moderator role', 'ERROR',
      'public.app_role enum missing? ' || sqlerrm);
  end;
end
$$;

-- ---------------------------------------------------------------------
-- 5. What has it done so far?
-- ---------------------------------------------------------------------
insert into _check
select 'videos hidden right now',
       coalesce((select count(*)::text from public.videos where hidden = true), '0'), '';

-- Counted dynamically: on a half-installed database these tables may not
-- exist yet, and that must be reported, not thrown as an error.
do $$
declare
  t text;
  n bigint;
begin
  foreach t in array array['moderation_log','banned_users','user_strikes','identity_bans']
  loop
    if to_regclass('public.' || t) is null then
      insert into _check values (t || ' rows', 'MISSING', 'table does not exist');
    else
      execute format('select count(*) from public.%I', t) into n;
      insert into _check values (t || ' rows', n::text, '');
    end if;
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- 6. THE REAL TEST: does a bad caption get hidden on insert?
--    Inserts a throwaway row, checks it, deletes it.
-- ---------------------------------------------------------------------
do $$
declare
  probe uuid := gen_random_uuid();
  v_hidden boolean;
  v_reason text;
  v_err text;
begin
  begin
    insert into public.videos (id, username, caption, video_url)
    values (probe, 'zz_safety_probe', 'porn naked sex', 'probe://none');

    select hidden, hidden_reason into v_hidden, v_reason
      from public.videos where id = probe;

    if v_hidden is null then
      insert into _check values ('LIVE TEST bad video',
        'FAIL', 'row was not stored at all (a trigger cancelled it)');
    elsif v_hidden then
      insert into _check values ('LIVE TEST bad video', 'PASS',
        'hidden immediately, reason: ' || coalesce(v_reason,'null'));
    else
      insert into _check values ('LIVE TEST bad video', 'FAIL',
        'stored VISIBLE -- the trigger did not fire');
    end if;

    delete from public.videos where id = probe;

  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into _check values ('LIVE TEST bad video', 'ERROR', sqlstate || ' - ' || v_err);
    begin
      delete from public.videos where id = probe;
    exception when others then null;
    end;
  end;
end
$$;

-- A clean caption must stay visible.
do $$
declare
  probe uuid := gen_random_uuid();
  v_hidden boolean;
  v_err text;
begin
  begin
    insert into public.videos (id, username, caption, video_url)
    values (probe, 'zz_safety_probe', 'my cooking tutorial', 'probe://none');

    select hidden into v_hidden from public.videos where id = probe;

    if v_hidden is false then
      insert into _check values ('LIVE TEST clean video', 'PASS', 'stayed visible');
    else
      insert into _check values ('LIVE TEST clean video', 'FAIL',
        'clean caption was hidden -- false positive');
    end if;

    delete from public.videos where id = probe;

  exception when others then
    get stacked diagnostics v_err = message_text;
    insert into _check values ('LIVE TEST clean video', 'ERROR', sqlstate || ' - ' || v_err);
    begin
      delete from public.videos where id = probe;
    exception when others then null;
    end;
  end;
end
$$;

-- ---------------------------------------------------------------------
-- 7. Can the signed-in account run the sweep?
-- ---------------------------------------------------------------------
insert into _check
select 'am I the owner?',
       case
         when to_regprocedure('public.is_owner_uid(uuid)') is null then 'MISSING'
         when public.is_owner_uid(auth.uid()) then 'YES'
         else 'NO'
       end,
       'auth.uid() = ' || coalesce(auth.uid()::text, 'null (SQL editor runs as postgres)');

-- ---------------------------------------------------------------------
-- RESULT
-- ---------------------------------------------------------------------
select step, result, detail from _check
order by case result when 'FAIL' then 0 when 'ERROR' then 1 when 'MISSING' then 2 else 3 end,
         step;

-- One-line verdict.
select case
  when exists (select 1 from _check where result in ('FAIL','ERROR','MISSING'))
    then 'PROBLEM FOUND -- see the rows marked FAIL / ERROR / MISSING above'
  else 'ALL CHECKS PASSED -- the bot is installed and removing content'
end as verdict;
