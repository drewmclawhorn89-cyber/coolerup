-- Paste this whole file into Lovable > Database > SQL Editor, then run it.
-- Sets up real account-backed subscriptions keyed ONLY by user_id (1 row per user),
-- public.subscription_plans, profiles sync, and protects @drewmclawhorn3 forever.

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
  ('vip', 'VIP', '👑', 2999, '["Everything in Pro","Offline video downloads","Offline music downloads","Background play","VIP badge","Early access to new features"]'::jsonb, true, true, true, 3, true)
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

alter table public.user_subscriptions add column if not exists plan_name text;
alter table public.user_subscriptions add column if not exists plan_status text not null default 'active';
alter table public.user_subscriptions add column if not exists status text not null default 'active';
alter table public.user_subscriptions add column if not exists started_at timestamptz not null default now();
alter table public.user_subscriptions add column if not exists expires_at timestamptz;
alter table public.user_subscriptions add column if not exists payment_method text;
alter table public.user_subscriptions add column if not exists auto_renew boolean not null default true;

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

alter table public.user_subscriptions drop constraint if exists user_subscriptions_user_plan_key;
alter table public.user_subscriptions drop constraint if exists user_subscriptions_user_id_key;
alter table public.user_subscriptions add constraint user_subscriptions_user_id_key unique (user_id);

create index if not exists user_subscriptions_user_id_idx
  on public.user_subscriptions (user_id);

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
