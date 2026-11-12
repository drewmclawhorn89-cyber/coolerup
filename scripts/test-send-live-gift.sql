-- Minimal harness: proves public.send_live_gift runs end-to-end without the
-- "column reference gift_id is ambiguous" error. Run with:
--   psql -f scripts/test-send-live-gift.sql
\set ON_ERROR_STOP on

create schema if not exists auth;

create or replace function auth.uid() returns uuid
language sql stable as $$ select current_setting('test.uid', true)::uuid $$;

create table if not exists public.profiles (
  id uuid primary key,
  handle text,
  username text
);

create table if not exists public.user_coins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 0,
  paid_balance integer not null default 0,
  total_spent integer not null default 0,
  total_earned integer not null default 0,
  diamonds integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.user_balance (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  real_balance numeric(10, 2) not null default 0,
  diamonds integer not null default 0,
  total_earned numeric(10, 2) not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.live_gifts (
  id uuid primary key default gen_random_uuid(),
  live_id uuid,
  sender_id uuid,
  receiver_id uuid,
  gift_type text,
  coins integer,
  quantity integer,
  diamonds integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.gift_claims (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null unique references public.live_gifts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  diamonds integer not null default 0,
  amount numeric(10, 2) not null default 0,
  gift text,
  coins integer not null default 0,
  created_at timestamptz not null default now()
);

-- Load the function under test.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
end $$;

\i supabase/migrations/20261115000000_fix_send_live_gift_ambiguity.sql

-- Seed a sender with 100 coins (50 paid, 50 free) and a receiver.
insert into public.profiles (id, handle, username) values
  ('11111111-1111-1111-1111-111111111111', 'sender', 'sender'),
  ('22222222-2222-2222-2222-222222222222', 'host', 'host')
on conflict (id) do nothing;

insert into public.user_coins (user_id, balance, paid_balance) values
  ('11111111-1111-1111-1111-111111111111', 100, 50)
on conflict (user_id) do update set balance = 100, paid_balance = 50;

delete from public.gift_claims;
delete from public.live_gifts;

select set_config('test.uid', '11111111-1111-1111-1111-111111111111', false);

-- The call that used to raise 42702 "column reference gift_id is ambiguous".
select * from public.send_live_gift(
  '33333333-3333-3333-3333-333333333333'::uuid,
  '22222222-2222-2222-2222-222222222222'::uuid,
  'rose',
  10,
  2
);

do $$
declare
  v_claims integer;
  v_sender_balance integer;
  v_gift_coins integer;
begin
  select count(*) into v_claims from public.gift_claims;
  if v_claims <> 1 then
    raise exception 'expected 1 gift_claim, got %', v_claims;
  end if;

  select balance into v_sender_balance
    from public.user_coins
   where user_id = '11111111-1111-1111-1111-111111111111';
  if v_sender_balance <> 90 then
    raise exception 'expected sender balance 90, got %', v_sender_balance;
  end if;

  select coins into v_gift_coins from public.live_gifts limit 1;
  if v_gift_coins <> 10 then
    raise exception 'expected gift coins 10, got %', v_gift_coins;
  end if;

  raise notice 'send_live_gift OK: 1 claim, balance 90, gift coins 10';
end $$;
