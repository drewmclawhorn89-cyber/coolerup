-- ===========================================================================
-- 20261231000000 · REAL ACCOUNT-BACKED SUBSCRIPTIONS (ONE ROW PER user_id)
--
-- 1. `public.subscription_plans`: real plan catalogue read from Supabase.
-- 2. `public.user_subscriptions`: keyed strictly by `user_id` ONLY (1 row per
--    account). Includes user_id, plan_id, plan_name, plan_status
--    ('active' | 'cancelled' | 'expired' | 'pending' | 'trialing'),
--    started_at, expires_at, payment_method. Switching plans updates the SAME
--    user_id row instead of creating duplicates.
-- 3. `public.profiles`: mirrors active subscription metadata on the user's
--    profile row via SECURITY DEFINER triggers (only readable by owner via
--    my_profile()).
-- 4. Owner `@drewmclawhorn3` NEVER loses their All Access Forever plan.
-- ===========================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. Real plans catalogue (`public.subscription_plans`)
-- ---------------------------------------------------------------------------

create table if not exists public.subscription_plans (
  id text primary key,
  plan_name text not null,
  emoji text not null default '',
  price_cents integer not null check (price_cents >= 0),
  perks jsonb not null default '[]'::jsonb,
  offline boolean not null default false,
  music_offline boolean not null default false,
  background_play boolean not null default false,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;

drop policy if exists "subscription_plans_public_read" on public.subscription_plans;
create policy "subscription_plans_public_read"
  on public.subscription_plans for select
  to anon, authenticated
  using (active = true);

grant select on public.subscription_plans to anon, authenticated;

insert into public.subscription_plans (
  id, plan_name, emoji, price_cents, perks, offline, music_offline, background_play, sort_order, active
)
values
  (
    'plus',
    'Plus',
    '⭐',
    799,
    '["Ad-free feed","Plus badge on your profile","Offline video downloads"]'::jsonb,
    true,
    false,
    false,
    1,
    true
  ),
  (
    'pro',
    'Pro',
    '🚀',
    1499,
    '["Everything in Plus","Offline video downloads","Exclusive tops and names","Priority uploads"]'::jsonb,
    true,
    false,
    false,
    2,
    true
  ),
  (
    'vip',
    'VIP',
    '👑',
    2999,
    '["Everything in Pro","Offline video downloads","Offline music downloads","Background play","VIP badge","Early access to new features"]'::jsonb,
    true,
    true,
    true,
    3,
    true
  )
on conflict (id) do update set
  plan_name = excluded.plan_name,
  emoji = excluded.emoji,
  price_cents = excluded.price_cents,
  perks = excluded.perks,
  offline = excluded.offline,
  music_offline = excluded.music_offline,
  background_play = excluded.background_play,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. `public.user_subscriptions` — keyed strictly by user_id ONLY
-- ---------------------------------------------------------------------------

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  plan_name text,
  plan_status text not null default 'active',
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  payment_method text,
  auto_renew boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_subscriptions
  add column if not exists plan_name text;
alter table public.user_subscriptions
  add column if not exists plan_status text not null default 'active';
alter table public.user_subscriptions
  add column if not exists status text not null default 'active';
alter table public.user_subscriptions
  add column if not exists started_at timestamptz not null default now();
alter table public.user_subscriptions
  add column if not exists expires_at timestamptz;
alter table public.user_subscriptions
  add column if not exists payment_method text;
alter table public.user_subscriptions
  add column if not exists auto_renew boolean not null default true;

-- Backfill plan_status & plan_name on existing rows.
update public.user_subscriptions us
set
  plan_status = coalesce(nullif(us.plan_status, ''), nullif(us.status, ''), 'active'),
  status = coalesce(nullif(us.status, ''), nullif(us.plan_status, ''), 'active'),
  plan_name = coalesce(
    nullif(us.plan_name, ''),
    (select sp.plan_name from public.subscription_plans sp where sp.id = us.plan_id),
    initcap(us.plan_id)
  );

-- Deduplicate so each user_id has AT MOST ONE row (active > pending > cancelled > expired, newest wins).
with ranked as (
  select
    ctid,
    row_number() over (
      partition by user_id
      order by
        case coalesce(plan_status, status, 'expired')
          when 'active' then 4
          when 'trialing' then 4
          when 'pending' then 3
          when 'cancelled' then 2
          else 1
        end desc,
        updated_at desc nulls last,
        created_at desc nulls last
    ) as rn
  from public.user_subscriptions
)
delete from public.user_subscriptions us
using ranked r
where us.ctid = r.ctid
  and r.rn > 1;

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_user_plan_key;

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_user_id_key;

alter table public.user_subscriptions
  add constraint user_subscriptions_user_id_key unique (user_id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_subscriptions_plan_status_check'
  ) then
    alter table public.user_subscriptions
      add constraint user_subscriptions_plan_status_check
      check (plan_status in ('active', 'pending', 'cancelled', 'expired', 'trialing'));
  end if;
end
$$;

create index if not exists user_subscriptions_user_id_idx
  on public.user_subscriptions (user_id);

-- ---------------------------------------------------------------------------
-- 3. `public.profiles` subscription mirror columns (owner-visible via my_profile)
-- ---------------------------------------------------------------------------

do $$
begin
  if to_regclass('public.profiles') is not null then
    alter table public.profiles add column if not exists plan_id text;
    alter table public.profiles add column if not exists plan_name text;
    alter table public.profiles add column if not exists plan_status text;
    alter table public.profiles add column if not exists plan_started_at timestamptz;
    alter table public.profiles add column if not exists plan_expires_at timestamptz;
    alter table public.profiles add column if not exists payment_method text;
  end if;
end
$$;

create or replace function public.sync_user_subscriptions_before_write()
returns trigger
language plpgsql
as $$
declare
  v_plan_name text;
begin
  if tg_op = 'INSERT' then
    new.plan_status := coalesce(nullif(new.plan_status, ''), nullif(new.status, ''), 'active');
    new.status := new.plan_status;
  else
    if new.plan_status is distinct from old.plan_status and new.plan_status is not null then
      new.status := new.plan_status;
    elsif new.status is distinct from old.status and new.status is not null then
      new.plan_status := new.status;
    else
      new.plan_status := coalesce(nullif(new.plan_status, ''), nullif(new.status, ''), 'active');
      new.status := new.plan_status;
    end if;
  end if;

  if new.plan_name is null or trim(new.plan_name) = '' then
    select sp.plan_name into v_plan_name
    from public.subscription_plans sp
    where sp.id = new.plan_id
    limit 1;
    new.plan_name := coalesce(v_plan_name, initcap(new.plan_id));
  end if;

  new.started_at := coalesce(new.started_at, now());
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_subscriptions_sync_before on public.user_subscriptions;
create trigger user_subscriptions_sync_before
  before insert or update on public.user_subscriptions
  for each row execute function public.sync_user_subscriptions_before_write();

create or replace function public.sync_user_subscription_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.profiles') is not null then
    update public.profiles
    set
      plan_id = new.plan_id,
      plan_name = new.plan_name,
      plan_status = new.plan_status,
      plan_started_at = new.started_at,
      plan_expires_at = new.expires_at,
      payment_method = new.payment_method
    where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists user_subscriptions_sync_profile on public.user_subscriptions;
create trigger user_subscriptions_sync_profile
  after insert or update on public.user_subscriptions
  for each row execute function public.sync_user_subscription_to_profile();

-- Backfill profiles from existing user_subscriptions rows.
update public.profiles p
set
  plan_id = us.plan_id,
  plan_name = us.plan_name,
  plan_status = us.plan_status,
  plan_started_at = us.started_at,
  plan_expires_at = us.expires_at,
  payment_method = us.payment_method
from public.user_subscriptions us
where us.user_id = p.id;

-- ---------------------------------------------------------------------------
-- 4. RLS on `public.user_subscriptions` (owner-only read/write by user_id)
-- ---------------------------------------------------------------------------

alter table public.user_subscriptions enable row level security;

drop policy if exists "user_subscriptions_select_own" on public.user_subscriptions;
create policy "user_subscriptions_select_own"
  on public.user_subscriptions for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "user_subscriptions_insert_own" on public.user_subscriptions;
create policy "user_subscriptions_insert_own"
  on public.user_subscriptions for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "user_subscriptions_update_own" on public.user_subscriptions;
create policy "user_subscriptions_update_own"
  on public.user_subscriptions for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "user_subscriptions_delete_own" on public.user_subscriptions;
create policy "user_subscriptions_delete_own"
  on public.user_subscriptions for delete
  to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Owner @drewmclawhorn3 protection & lifetime guarantee
-- ---------------------------------------------------------------------------

do $$
declare
  v_owner_id uuid;
begin
  if to_regclass('public.profiles') is null then
    return;
  end if;

  select id into v_owner_id
  from public.profiles
  where lower(replace(handle, '@', '')) = 'drewmclawhorn3'
     or lower(coalesce(username, '')) = 'drewmclawhorn3'
  limit 1;

  if v_owner_id is not null and to_regclass('public.subscriptions') is not null then
    insert into public.subscriptions (
      user_id, plan, status, is_lifetime, granted_by, revoked_at, current_period_end, updated_at
    )
    values (
      v_owner_id, 'all', 'active', true, 'drewmclawhorn3', null, null, now()
    )
    on conflict (user_id) do update set
      plan = 'all',
      status = 'active',
      is_lifetime = true,
      granted_by = 'drewmclawhorn3',
      revoked_at = null,
      current_period_end = null,
      updated_at = now();
  end if;
end
$$;

create or replace function public.my_lifetime_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
  v_is_owner boolean := false;
begin
  if auth.uid() is null then
    return null;
  end if;

  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        lower(replace(handle, '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(username, '')) = 'drewmclawhorn3'
      )
  ) into v_is_owner;

  if v_is_owner then
    insert into public.subscriptions (
      user_id, plan, status, is_lifetime, granted_by, revoked_at, current_period_end, updated_at
    )
    values (
      auth.uid(), 'all', 'active', true, 'drewmclawhorn3', null, null, now()
    )
    on conflict (user_id) do update set
      plan = 'all',
      status = 'active',
      is_lifetime = true,
      granted_by = 'drewmclawhorn3',
      revoked_at = null,
      current_period_end = null,
      updated_at = now()
    returning * into v_row;

    return jsonb_build_object(
      'plan', v_row.plan,
      'status', v_row.status,
      'is_lifetime', v_row.is_lifetime,
      'granted_by', v_row.granted_by,
      'granted_at', v_row.created_at,
      'revoked_at', v_row.revoked_at
    );
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

create or replace function public.admin_revoke_lifetime(_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
  v_target_owner boolean := false;
begin
  if not public.is_lifetime_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select exists (
    select 1
    from public.profiles
    where id = _user_id
      and (
        lower(replace(handle, '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(username, '')) = 'drewmclawhorn3'
      )
  ) into v_target_owner;

  if v_target_owner then
    return jsonb_build_object('ok', false, 'error', 'cannot_revoke_owner');
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

create or replace function public.my_offline_entitlement()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text := null;
  v_video boolean := false;
  v_music boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('video', false, 'music', false, 'plan', null);
  end if;

  -- 1. Owner or lifetime grant takes highest priority.
  if exists (
    select 1 from public.profiles
    where id = v_uid
      and (
        lower(replace(handle, '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(username, '')) = 'drewmclawhorn3'
      )
  ) then
    return jsonb_build_object('video', true, 'music', true, 'plan', 'all');
  end if;

  if to_regclass('public.subscriptions') is not null then
    select s.plan into v_plan
    from public.subscriptions s
    where s.user_id = v_uid
      and s.status = 'active'
      and (s.is_lifetime or s.current_period_end is null or s.current_period_end > now())
    limit 1;

    if v_plan = 'all' or v_plan = 'vip' then
      return jsonb_build_object('video', true, 'music', true, 'plan', v_plan);
    elsif v_plan in ('plus', 'pro') then
      return jsonb_build_object('video', true, 'music', false, 'plan', v_plan);
    end if;
  end if;

  -- 2. Account subscription in public.user_subscriptions.
  select us.plan_id into v_plan
  from public.user_subscriptions us
  where us.user_id = v_uid
    and coalesce(us.plan_status, us.status) in ('active', 'trialing')
    and (us.expires_at is null or us.expires_at > now())
  limit 1;

  if v_plan is not null then
    v_video := v_plan in ('plus', 'pro', 'vip', 'all');
    v_music := v_plan in ('vip', 'all');
    return jsonb_build_object('video', v_video, 'music', v_music, 'plan', v_plan);
  end if;

  return jsonb_build_object('video', false, 'music', false, 'plan', null);
end;
$$;

revoke all on function public.my_lifetime_subscription() from public, anon;
revoke all on function public.admin_revoke_lifetime(uuid) from public, anon;
revoke all on function public.my_offline_entitlement() from public, anon;
grant execute on function public.my_lifetime_subscription() to authenticated;
grant execute on function public.admin_revoke_lifetime(uuid) to authenticated;
grant execute on function public.my_offline_entitlement() to authenticated;

notify pgrst, 'reload schema';
