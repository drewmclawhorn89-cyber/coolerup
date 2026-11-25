-- Paste this whole file into Lovable > Database > SQL Editor, then run it.
-- It creates public.user_subscriptions and locks it down with RLS.

create extension if not exists pgcrypto;

create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id text not null,
  plan_name text,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  expires_at timestamptz,
  auto_renew boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_subscriptions_user_plan_key unique (user_id, plan_id)
);

create index if not exists user_subscriptions_user_id_idx
  on public.user_subscriptions (user_id);

create or replace function public.touch_user_subscriptions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_subscriptions_touch_updated_at on public.user_subscriptions;
create trigger user_subscriptions_touch_updated_at
  before update on public.user_subscriptions
  for each row execute function public.touch_user_subscriptions_updated_at();

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
