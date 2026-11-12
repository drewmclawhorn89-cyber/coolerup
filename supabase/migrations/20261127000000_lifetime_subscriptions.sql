-- ---------------------------------------------------------------------------
-- Lifetime subscriptions
--
-- A lifetime grant is a `subscriptions` row with `is_lifetime = true` and
-- `status = 'active'`. It never expires: the app must never consult
-- `current_period_end` while `is_lifetime` is true, so a grant made today still
-- works in ten years.
--
-- Revoking is deliberately destructive to access: `admin_revoke_lifetime` flips
-- `status` to 'canceled' and stamps `revoked_at`. The app treats a canceled
-- lifetime row as "no plan at all", so the user drops back to the paywall on
-- their next check - no grace period, no cached expiry to wait out.
--
-- Writes are security-definer only. There is no INSERT/UPDATE/DELETE policy on
-- the table, which is what keeps a client from granting itself forever. (It is
-- also why the client must never `.upsert()` here: an upsert needs an UPDATE
-- policy and would fail with the RLS USING-expression error.)
-- ---------------------------------------------------------------------------

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- plus | pro | vip | all. `all` is the lifetime "everything" tier.
  plan text not null default 'plus',
  -- active | pending | canceled | expired
  status text not null default 'active',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id)
);

-- The three lifetime columns. `add column if not exists` so this migration is
-- safe against a database that already grew a `subscriptions` table.
alter table public.subscriptions
  add column if not exists is_lifetime boolean not null default false;
alter table public.subscriptions
  add column if not exists granted_by text;
alter table public.subscriptions
  add column if not exists revoked_at timestamptz;

-- Loose checks, added separately so they can be attached to a pre-existing
-- table without rewriting it.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_plan_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_plan_check
      check (plan in ('plus', 'pro', 'vip', 'all'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'subscriptions_status_check'
  ) then
    alter table public.subscriptions
      add constraint subscriptions_status_check
      check (status in ('active', 'pending', 'canceled', 'expired'));
  end if;
end
$$;

create index if not exists subscriptions_user_idx
  on public.subscriptions (user_id);
create index if not exists subscriptions_lifetime_idx
  on public.subscriptions (is_lifetime, status)
  where is_lifetime;

alter table public.subscriptions enable row level security;

-- Read your own row. No write policies on purpose: see the header.
drop policy if exists "users read own subscription" on public.subscriptions;
create policy "users read own subscription" on public.subscriptions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Admin gate
--
-- Same rule as the code minting: only @drewmclawhorn3.
-- ---------------------------------------------------------------------------

create or replace function public.is_lifetime_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and lower(replace(handle, '@', '')) = 'drewmclawhorn3'
  );
$$;

-- ---------------------------------------------------------------------------
-- Grant
--
-- _plan is 'pro', 'vip' or 'all'. 'all' also drops 1000 coins into the wallet
-- and unlocks the beta area (the client reads plan = 'all' for that), but the
-- coins are only added when this is a *new* grant - re-saving an existing
-- lifetime-all row must not top the balance up again.
-- ---------------------------------------------------------------------------

create or replace function public.admin_grant_lifetime(_handle text, _plan text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_handle text := lower(replace(trim(coalesce(_handle, '')), '@', ''));
  v_plan text := lower(trim(coalesce(_plan, '')));
  v_profile public.profiles;
  v_existing public.subscriptions;
  v_was_all boolean := false;
begin
  if not public.is_lifetime_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

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
    return jsonb_build_object('ok', false, 'error', 'user_not_found');
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
    'user_id', v_profile.id,
    'handle', v_profile.handle,
    'plan', v_plan
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Revoke
--
-- Instant. `is_lifetime` goes false as well so nothing downstream can mistake a
-- canceled row for a live grant by looking at the flag alone.
-- ---------------------------------------------------------------------------

create or replace function public.admin_revoke_lifetime(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
begin
  if not public.is_lifetime_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  update public.subscriptions
    set status = 'canceled',
        revoked_at = now(),
        is_lifetime = false,
        updated_at = now()
    where user_id = _user_id
      and is_lifetime
  returning * into v_row;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'user_id', v_row.user_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Lists
-- ---------------------------------------------------------------------------

create or replace function public.admin_list_lifetime()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_lifetime_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select coalesce(jsonb_agg(entry order by entry->>'granted_at' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'user_id', s.user_id,
      'handle', p.handle,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'plan', s.plan,
      'status', s.status,
      'granted_by', s.granted_by,
      'granted_at', s.created_at
    ) as entry
    from public.subscriptions s
    join public.profiles p on p.id = s.user_id
    where s.is_lifetime
      and s.status = 'active'
  ) rows;

  return jsonb_build_object('ok', true, 'users', v_rows);
end;
$$;

create or replace function public.admin_search_users(_q text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := lower(replace(trim(coalesce(_q, '')), '@', ''));
  v_rows jsonb;
begin
  if not public.is_lifetime_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  if v_q = '' then
    return jsonb_build_object('ok', true, 'users', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(entry), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'user_id', p.id,
      'handle', p.handle,
      'display_name', p.display_name,
      'avatar_url', p.avatar_url,
      'plan', s.plan,
      'is_lifetime', coalesce(s.is_lifetime, false)
    ) as entry
    from public.profiles p
    left join public.subscriptions s
      on s.user_id = p.id and s.is_lifetime and s.status = 'active'
    where lower(replace(p.handle, '@', '')) like v_q || '%'
       or lower(coalesce(p.username, '')) like v_q || '%'
       or lower(coalesce(p.display_name, '')) like '%' || v_q || '%'
    order by
      case
        when lower(replace(p.handle, '@', '')) = v_q then 0
        when lower(replace(p.handle, '@', '')) like v_q || '%' then 1
        else 2
      end,
      p.handle
    limit 10
  ) rows;

  return jsonb_build_object('ok', true, 'users', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Self
--
-- Returns the signed-in user's row, including a canceled one. The client needs
-- to tell "never had a grant" (null) from "had one, it was taken away"
-- (status = 'canceled') so a revoked user is blocked rather than silently
-- falling back to an old cached plan.
-- ---------------------------------------------------------------------------

create or replace function public.my_lifetime_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
begin
  if auth.uid() is null then
    return null;
  end if;

  select * into v_row
  from public.subscriptions
  where user_id = auth.uid()
  limit 1;

  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'plan', v_row.plan,
    'status', v_row.status,
    'is_lifetime', v_row.is_lifetime,
    'granted_by', v_row.granted_by,
    'granted_at', v_row.created_at,
    'revoked_at', v_row.revoked_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on function public.is_lifetime_admin() from public, anon;
revoke all on function public.admin_grant_lifetime(text, text) from public, anon;
revoke all on function public.admin_revoke_lifetime(uuid) from public, anon;
revoke all on function public.admin_list_lifetime() from public, anon;
revoke all on function public.admin_search_users(text) from public, anon;
revoke all on function public.my_lifetime_subscription() from public, anon;

grant execute on function public.admin_grant_lifetime(text, text) to authenticated;
grant execute on function public.admin_revoke_lifetime(uuid) to authenticated;
grant execute on function public.admin_list_lifetime() to authenticated;
grant execute on function public.admin_search_users(text) to authenticated;
grant execute on function public.my_lifetime_subscription() to authenticated;
