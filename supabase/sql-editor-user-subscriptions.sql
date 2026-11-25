-- Paste this whole file into Lovable > Database > SQL Editor, then run it.
-- Sets up real account-backed subscriptions keyed ONLY by user_id (1 row per user),
-- defaults everyone to Free (NEVER All Access Forever), enforces payment_verified,
-- checks expires_at, cleans existing unverified Forever users back to Free without
-- deleting any users or videos, and keeps owner @drewmclawhorn3 on Forever.

create extension if not exists pgcrypto;

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
  ('plus', 'Plus', '⭐', 799, '["Ad-free feed","Plus badge on your profile","Offline video downloads"]'::jsonb, true, false, false, 1, true),
  ('pro', 'Pro', '🚀', 1499, '["Everything in Plus","Offline video downloads","Exclusive tops and names","Priority uploads"]'::jsonb, true, false, false, 2, true),
  ('vip', 'VIP', '👑', 2999, '["Everything in Pro","Offline video downloads","Offline music downloads","Background play","VIP badge","Early access to new features"]'::jsonb, true, true, true, 3, true),
  ('all', 'All Access Forever', '👑', 9999, '["Everything in Plus, Pro and VIP","Offline video downloads","Offline music downloads","Background play","Beta features","Never expires"]'::jsonb, true, true, true, 4, true)
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

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null default 'free',
  plan_name text default 'Free',
  plan_status text not null default 'free',
  status text not null default 'free',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  payment_method text,
  payment_verified boolean not null default false,
  auto_renew boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_subscriptions add column if not exists plan_name text default 'Free';
alter table public.user_subscriptions add column if not exists plan_status text not null default 'free';
alter table public.user_subscriptions add column if not exists status text not null default 'free';
alter table public.user_subscriptions add column if not exists started_at timestamptz not null default now();
alter table public.user_subscriptions add column if not exists expires_at timestamptz;
alter table public.user_subscriptions add column if not exists payment_method text;
alter table public.user_subscriptions add column if not exists payment_verified boolean not null default false;
alter table public.user_subscriptions add column if not exists auto_renew boolean not null default false;

alter table public.user_subscriptions
  alter column plan_id set default 'free',
  alter column plan_name set default 'Free',
  alter column plan_status set default 'free',
  alter column status set default 'free',
  alter column payment_verified set default false,
  alter column auto_renew set default false;

with ranked as (
  select
    ctid,
    row_number() over (
      partition by user_id
      order by
        case coalesce(plan_status, status, 'free')
          when 'active' then 4
          when 'trialing' then 4
          when 'pending' then 3
          when 'cancelled' then 2
          when 'expired' then 1
          else 0
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

alter table public.user_subscriptions drop constraint if exists user_subscriptions_user_plan_key;
alter table public.user_subscriptions drop constraint if exists user_subscriptions_user_id_key;
alter table public.user_subscriptions add constraint user_subscriptions_user_id_key unique (user_id);

alter table public.user_subscriptions drop constraint if exists user_subscriptions_plan_status_check;
alter table public.user_subscriptions
  add constraint user_subscriptions_plan_status_check
  check (plan_status in ('free', 'active', 'pending', 'cancelled', 'expired', 'trialing'));

create index if not exists user_subscriptions_user_id_idx
  on public.user_subscriptions (user_id);

-- Fix existing users: anyone on All Access Forever with NO payment record -> Free.
update public.user_subscriptions us
set
  payment_verified = true,
  plan_name = case when us.plan_id = 'all' then 'All Access Forever' else us.plan_name end,
  expires_at = case when us.plan_id = 'all' then null else us.expires_at end
where coalesce(us.plan_status, us.status) in ('active', 'trialing')
  and us.plan_id <> 'free'
  and (us.expires_at is null or us.expires_at > now())
  and (
    us.payment_verified = true
    or (
      coalesce(trim(us.payment_method), '') <> ''
      and lower(trim(us.payment_method)) not in ('free', 'none', 'null', 'pending', 'venmo')
    )
    or exists (
      select 1 from public.profiles p
      where p.id = us.user_id
        and (
          lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
          or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
        )
    )
  );

update public.user_subscriptions us
set
  plan_id = 'free',
  plan_name = 'Free',
  plan_status = 'free',
  status = 'free',
  payment_verified = false,
  payment_method = null,
  expires_at = null,
  auto_renew = false,
  updated_at = now()
where (
  us.plan_id = 'all'
  or lower(coalesce(us.plan_name, '')) like '%all access forever%'
  or lower(coalesce(us.plan_name, '')) like '%lifetime all access%'
)
  and not (
    us.payment_verified = true
    and coalesce(us.plan_status, us.status) = 'active'
  )
  and not exists (
    select 1 from public.profiles p
    where p.id = us.user_id
      and (
        lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
      )
  );

update public.user_subscriptions us
set
  plan_status = 'expired',
  status = 'expired',
  auto_renew = false,
  updated_at = now()
where us.plan_id not in ('all', 'free')
  and coalesce(us.plan_status, us.status) in ('active', 'trialing')
  and us.expires_at is not null
  and us.expires_at <= now();

do $$
begin
  if to_regclass('public.subscriptions') is not null then
    alter table public.subscriptions add column if not exists payment_verified boolean not null default false;
    alter table public.subscriptions
      alter column plan set default 'free',
      alter column status set default 'free',
      alter column is_lifetime set default false,
      alter column payment_verified set default false;
    alter table public.subscriptions drop constraint if exists subscriptions_plan_check;
    alter table public.subscriptions add constraint subscriptions_plan_check check (plan in ('free', 'plus', 'pro', 'vip', 'all'));
    alter table public.subscriptions drop constraint if exists subscriptions_status_check;
    alter table public.subscriptions add constraint subscriptions_status_check check (status in ('free', 'active', 'pending', 'canceled', 'expired'));

    update public.subscriptions s
    set payment_verified = true, current_period_end = null, updated_at = now()
    where s.plan = 'all'
      and s.status = 'active'
      and exists (
        select 1 from public.user_subscriptions us
        where us.user_id = s.user_id and us.plan_id = 'all' and us.plan_status = 'active' and us.payment_verified = true
      );

    if to_regclass('public.profiles') is not null then
      insert into public.subscriptions (
        user_id, plan, status, is_lifetime, payment_verified, granted_by, revoked_at, current_period_end, updated_at
      )
      select p.id, 'all', 'active', true, true, 'drewmclawhorn3', null, null, now()
      from public.profiles p
      where lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
         or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
      on conflict (user_id) do update set
        plan = 'all',
        status = 'active',
        is_lifetime = true,
        payment_verified = true,
        granted_by = 'drewmclawhorn3',
        revoked_at = null,
        current_period_end = null,
        updated_at = now();
    end if;

    update public.subscriptions s
    set
      plan = 'free',
      status = 'free',
      is_lifetime = false,
      payment_verified = false,
      granted_by = null,
      current_period_end = null,
      updated_at = now()
    where (s.plan = 'all' or s.is_lifetime = true)
      and coalesce(s.payment_verified, false) = false
      and not exists (
        select 1 from public.profiles p
        where p.id = s.user_id
          and (
            lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
            or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
          )
      );
  end if;

  if to_regclass('public.profiles') is not null then
    alter table public.profiles add column if not exists plan_id text default 'free';
    alter table public.profiles add column if not exists plan_name text default 'Free';
    alter table public.profiles add column if not exists plan_status text default 'free';
    alter table public.profiles add column if not exists plan_started_at timestamptz;
    alter table public.profiles add column if not exists plan_expires_at timestamptz;
    alter table public.profiles add column if not exists payment_method text;
    alter table public.profiles add column if not exists payment_verified boolean not null default false;

    update public.profiles p
    set
      plan_id = us.plan_id,
      plan_name = us.plan_name,
      plan_status = us.plan_status,
      plan_started_at = us.started_at,
      plan_expires_at = us.expires_at,
      payment_method = us.payment_method,
      payment_verified = us.payment_verified
    from public.user_subscriptions us
    where us.user_id = p.id;

    update public.profiles p
    set
      plan_id = 'free',
      plan_name = 'Free',
      plan_status = 'free',
      plan_expires_at = null,
      payment_method = null,
      payment_verified = false
    where not exists (select 1 from public.user_subscriptions us where us.user_id = p.id)
      and not (
        lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
      )
      and (
        p.plan_id is null
        or p.plan_id = 'all'
        or lower(coalesce(p.plan_name, '')) like '%all access forever%'
        or lower(coalesce(p.plan_name, '')) like '%lifetime all access%'
      );

    update public.profiles p
    set
      plan_id = 'all',
      plan_name = 'All Access Forever',
      plan_status = 'active',
      plan_expires_at = null,
      payment_verified = true
    where lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
       or lower(coalesce(p.username, '')) = 'drewmclawhorn3';
  end if;
end
$$;

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

notify pgrst, 'reload schema';
