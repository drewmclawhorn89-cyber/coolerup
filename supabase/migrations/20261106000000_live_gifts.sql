-- TikTok-style LIVE gifts: coins, gift sends, coin purchases and cashouts.
--
-- STRICTLY ADDITIVE. Nothing here drops or rewrites an existing row, so every
-- video, like, comment, follower and profile stays exactly as it is. The only
-- write to existing data is the one-time 100 free coins grant below, which adds
-- a row per profile and never touches the profile itself.
--
-- NOTE ON live_id: Coolerup LIVE streams are ephemeral Supabase realtime rooms
-- keyed by the host's user id (see LiveStreamDialog). There is no `lives` table,
-- so live_id is TEXT holding that room key instead of a UUID foreign key.

-- ---------------------------------------------------------------------------
-- 1. Wallet
-- ---------------------------------------------------------------------------

create table if not exists public.user_coins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- 100 free coins to start, exactly like TikTok's welcome balance.
  balance integer not null default 100 check (balance >= 0),
  -- Coins this account has received from gifts (streamer side).
  total_earned integer not null default 0,
  -- Coins this account has spent on gifts (viewer side).
  total_spent integer not null default 0,
  -- Coins bought with real money.
  total_recharged integer not null default 0,
  -- Diamonds are the streamer currency: 100 coins = 50 diamonds = $0.50.
  diamonds integer not null default 0 check (diamonds >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. Gift log
-- ---------------------------------------------------------------------------

create table if not exists public.live_gifts (
  id uuid primary key default gen_random_uuid(),
  -- Host user id / realtime room key for the stream the gift was sent in.
  live_id text not null,
  sender_id uuid not null references public.profiles (id) on delete cascade,
  receiver_id uuid not null references public.profiles (id) on delete cascade,
  gift_type text not null,
  -- Total coins for the send (unit price x quantity), so SUM(coins) is revenue.
  coins integer not null check (coins >= 0),
  quantity integer not null default 1 check (quantity between 1 and 100),
  created_at timestamptz not null default now()
);

create index if not exists live_gifts_live_id_idx
  on public.live_gifts (live_id, created_at desc);
create index if not exists live_gifts_receiver_idx
  on public.live_gifts (receiver_id, created_at desc);
create index if not exists live_gifts_sender_idx
  on public.live_gifts (sender_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Real-money coin purchases (Stripe Checkout)
-- ---------------------------------------------------------------------------

create table if not exists public.coin_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id text not null,
  coins integer not null check (coins > 0),
  amount_cents integer not null check (amount_cents > 0),
  -- pending -> paid | failed. Coins are only credited on `paid`.
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  stripe_session_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists coin_purchases_user_idx
  on public.coin_purchases (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Streamer cashouts
-- ---------------------------------------------------------------------------

create table if not exists public.coin_cashouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  diamonds integer not null check (diamonds > 0),
  coins integer not null check (coins > 0),
  amount_cents integer not null check (amount_cents > 0),
  -- Payouts are reviewed manually; nothing here moves money by itself.
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  created_at timestamptz not null default now()
);

create index if not exists coin_cashouts_user_idx
  on public.coin_cashouts (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Row level security
-- ---------------------------------------------------------------------------

alter table public.user_coins enable row level security;
alter table public.live_gifts enable row level security;
alter table public.coin_purchases enable row level security;
alter table public.coin_cashouts enable row level security;

-- Wallets are private. Balances only change through the RPC or the service role.
drop policy if exists "read own coin balance" on public.user_coins;
create policy "read own coin balance"
  on public.user_coins for select
  using (auth.uid() = user_id);

-- Gifts are public: the ticker and top-gifter board are visible to every viewer.
drop policy if exists "live gifts are public" on public.live_gifts;
create policy "live gifts are public"
  on public.live_gifts for select
  using (true);

-- Receipts are private to the buyer.
drop policy if exists "read own coin purchases" on public.coin_purchases;
create policy "read own coin purchases"
  on public.coin_purchases for select
  using (auth.uid() = user_id);

drop policy if exists "read own coin cashouts" on public.coin_cashouts;
create policy "read own coin cashouts"
  on public.coin_cashouts for select
  using (auth.uid() = user_id);

-- No insert/update policies: sends go through send_live_gift(), purchases go
-- through the Stripe server function using the service role key. That keeps a
-- client from minting coins or gifting from someone else's wallet.

-- ---------------------------------------------------------------------------
-- 6. Atomic gift send
-- ---------------------------------------------------------------------------

create or replace function public.send_live_gift(
  p_live_id text,
  p_receiver_id uuid,
  p_gift_type text,
  p_coins integer,
  p_quantity integer default 1
)
returns table (gift_id uuid, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_balance integer;
  v_gift_id uuid;
  v_diamonds integer;
begin
  if v_sender is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_receiver_id is null or p_receiver_id = v_sender then
    raise exception 'invalid_receiver' using errcode = '22023';
  end if;
  if p_coins is null or p_coins <= 0 or p_coins > 100000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  -- Deduct first, guarded by the balance check, so two rapid taps can never
  -- push a wallet negative.
  update public.user_coins
     set balance = balance - p_coins,
         total_spent = total_spent + p_coins,
         updated_at = now()
   where user_id = v_sender
     and balance >= p_coins
  returning balance into v_balance;

  if v_balance is null then
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  insert into public.live_gifts (live_id, sender_id, receiver_id, gift_type, coins, quantity)
  values (p_live_id, v_sender, p_receiver_id, p_gift_type, p_coins, p_quantity)
  returning id into v_gift_id;

  -- Streamer earns diamonds at 100 coins = 50 diamonds.
  v_diamonds := p_coins / 2;

  insert into public.user_coins (user_id, balance, total_earned, diamonds)
  values (p_receiver_id, 0, p_coins, v_diamonds)
  on conflict (user_id) do update
    set total_earned = public.user_coins.total_earned + excluded.total_earned,
        diamonds = public.user_coins.diamonds + excluded.diamonds,
        updated_at = now();

  return query select v_gift_id, v_balance;
end;
$$;

revoke all on function public.send_live_gift(text, uuid, text, integer, integer) from public;
grant execute on function public.send_live_gift(text, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Free starter coins
-- ---------------------------------------------------------------------------

-- Every existing account gets 100 free coins. ON CONFLICT DO NOTHING means
-- re-running this migration never tops anyone up twice.
insert into public.user_coins (user_id, balance)
select id, 100 from public.profiles
on conflict (user_id) do nothing;

-- Brand new accounts get the same welcome balance automatically.
create or replace function public.grant_starter_coins()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_coins (user_id, balance)
  values (new.id, 100)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_grant_starter_coins on public.profiles;
create trigger profiles_grant_starter_coins
  after insert on public.profiles
  for each row execute function public.grant_starter_coins();
