-- ---------------------------------------------------------------------------
-- Handle-first lifetime grants
--
-- The admin page already takes a username. This adds the same convenience to
-- the SQL editor, where the previous workflow was "look up the uuid, then paste
-- it into an insert" - and where a pasted handle produced
--   ERROR 22P02: invalid input syntax for type uuid: " @fan03768 "
--
-- These two functions take a handle ('fan03768' or '@fan03768') and do the
-- lookup themselves. They are *not* granted to anon or authenticated: the
-- Supabase SQL editor runs as the `postgres` role, which keeps execute by
-- default, so this is a console-only tool. The in-app path stays
-- admin_grant_lifetime(), which is gated on auth.uid().
-- ---------------------------------------------------------------------------

create or replace function public.owner_grant_lifetime(_handle text, _plan text default 'all')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(replace(trim(coalesce(_handle, '')), '@', ''));
  v_plan text := lower(trim(coalesce(_plan, 'all')));
  v_profile public.profiles;
  v_existing public.subscriptions;
  v_was_all boolean := false;
begin
  if v_handle = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_handle');
  end if;

  if v_plan not in ('pro', 'vip', 'all') then
    return jsonb_build_object('ok', false, 'error', 'invalid_plan');
  end if;

  select * into v_profile
  from public.profiles
  where lower(replace(handle, '@', '')) = v_handle
     or lower(coalesce(username, '')) = v_handle
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'user_not_found', 'handle', v_handle);
  end if;

  select * into v_existing
  from public.subscriptions
  where user_id = v_profile.id
  for update;

  if found then
    v_was_all := v_existing.is_lifetime
      and v_existing.status = 'active'
      and v_existing.plan = 'all';
  end if;

  insert into public.subscriptions as s (
    user_id, plan, status, is_lifetime, granted_by, revoked_at, current_period_end, updated_at
  )
  values (
    v_profile.id, v_plan, 'active', true, 'drewmclawhorn3', null, null, now()
  )
  on conflict (user_id) do update set
    plan = excluded.plan,
    status = 'active',
    is_lifetime = true,
    granted_by = 'drewmclawhorn3',
    revoked_at = null,
    current_period_end = null,
    updated_at = now();

  -- 'all' bundles 1000 coins, once per grant.
  if v_plan = 'all' and not v_was_all then
    insert into public.user_coins as c (user_id, balance)
    values (v_profile.id, 1000)
    on conflict (user_id) do update set
      balance = c.balance + 1000,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'handle', v_profile.handle,
    'plan', v_plan,
    'coins_added', case when v_plan = 'all' and not v_was_all then 1000 else 0 end
  );
end;
$$;

create or replace function public.owner_revoke_lifetime(_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(replace(trim(coalesce(_handle, '')), '@', ''));
  v_profile public.profiles;
  v_row public.subscriptions;
begin
  if v_handle = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_handle');
  end if;

  select * into v_profile
  from public.profiles
  where lower(replace(handle, '@', '')) = v_handle
     or lower(coalesce(username, '')) = v_handle
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'user_not_found', 'handle', v_handle);
  end if;

  update public.subscriptions
    set status = 'canceled',
        revoked_at = now(),
        is_lifetime = false,
        updated_at = now()
    where user_id = v_profile.id
      and is_lifetime
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found', 'handle', v_profile.handle);
  end if;

  return jsonb_build_object('ok', true, 'handle', v_profile.handle);
end;
$$;

-- Console-only: the SQL editor runs as postgres and keeps execute. The app
-- roles must not be able to call these without the auth.uid() gate.
revoke all on function public.owner_grant_lifetime(text, text) from public, anon, authenticated;
revoke all on function public.owner_revoke_lifetime(text) from public, anon, authenticated;
