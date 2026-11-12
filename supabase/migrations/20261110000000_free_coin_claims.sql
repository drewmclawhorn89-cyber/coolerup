-- ---------------------------------------------------------------------------
-- Free 10 coins via Venmo
--
-- Viewers can claim 10 free coins once per day by opening the Coolerup Venmo
-- page and confirming they did so. The claim is recorded in
-- `free_coin_claims` (so hosts can audit it) and the wallet is credited in the
-- same transaction by a security-definer function, so nobody can credit
-- themselves more than once a day.
--
-- STRICTLY ADDITIVE: nothing here drops or rewrites existing data.
-- ---------------------------------------------------------------------------

-- Safety net: the wallet table normally comes from 20261106000000_live_gifts.
create table if not exists public.user_coins (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  balance integer not null default 100 check (balance >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 1. Claims log
-- ---------------------------------------------------------------------------

create table if not exists public.free_coin_claims (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  -- Snapshot of the name at claim time, so the host list still reads well if
  -- the account is renamed or deleted later.
  username text,
  claimed_at timestamptz not null default now(),
  venmo_clicked boolean not null default true,
  coins_given integer not null default 10 check (coins_given >= 0)
);

create index if not exists free_coin_claims_user_idx
  on public.free_coin_claims (user_id, claimed_at desc);
create index if not exists free_coin_claims_claimed_idx
  on public.free_coin_claims (claimed_at desc);

-- One claim per user per UTC day. This is the hard guarantee behind the
-- "once per day" rule; the function below also checks first for a friendly
-- error, but two racing requests can only ever create one row.
create unique index if not exists free_coin_claims_one_per_day_idx
  on public.free_coin_claims (user_id, ((claimed_at at time zone 'UTC')::date));

alter table public.free_coin_claims enable row level security;

-- Buyers can read their own claims (so the coins page can show the countdown).
drop policy if exists "users read own free coin claims" on public.free_coin_claims;
create policy "users read own free coin claims" on public.free_coin_claims
  for select using (user_id = auth.uid());

-- Admins can read every claim (the host dashboard subscribes to this table).
-- `coin_admin_ok()` is defined in 20261109000000_coin_venmo_orders.sql.
do $$
begin
  if to_regprocedure('public.coin_admin_ok()') is not null then
    drop policy if exists "admins read all free coin claims" on public.free_coin_claims;
    create policy "admins read all free coin claims" on public.free_coin_claims
      for select using (public.coin_admin_ok());
  end if;
end;
$$;

-- Writes go through the security-definer functions only: no insert/update
-- policies, so a client can never write its own claim row.

-- ---------------------------------------------------------------------------
-- 2. Claim 10 free coins (once per day)
-- ---------------------------------------------------------------------------

create or replace function public.claim_free_coins()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_username text;
  v_claim public.free_coin_claims;
  v_balance integer;
  v_today date := (now() at time zone 'UTC')::date;
  v_next timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in to claim free coins');
  end if;

  -- Midnight UTC tomorrow, used for the client countdown.
  v_next := ((v_today + 1)::timestamp at time zone 'UTC');

  select coalesce(p.username, p.handle)
    into v_username
    from public.profiles p
   where p.id = v_uid;

  -- Already claimed today?
  select c.*
    into v_claim
    from public.free_coin_claims c
   where c.user_id = v_uid
     and (c.claimed_at at time zone 'UTC')::date = v_today
   order by c.claimed_at desc
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', false,
      'alreadyClaimed', true,
      'error', 'You already claimed your 10 free coins today',
      'claimedAt', v_claim.claimed_at,
      'nextClaimAt', v_next
    );
  end if;

  begin
    insert into public.free_coin_claims (user_id, username, venmo_clicked, coins_given)
    values (v_uid, v_username, true, 10)
    returning * into v_claim;
  exception when unique_violation then
    -- A parallel request won the race; treat it as already claimed.
    return jsonb_build_object(
      'ok', false,
      'alreadyClaimed', true,
      'error', 'You already claimed your 10 free coins today',
      'nextClaimAt', v_next
    );
  end;

  insert into public.user_coins as uc (user_id, balance, updated_at)
  values (v_uid, v_claim.coins_given, now())
  on conflict (user_id) do update
    set balance = uc.balance + v_claim.coins_given,
        updated_at = now()
  returning uc.balance into v_balance;

  return jsonb_build_object(
    'ok', true,
    'coins', v_claim.coins_given,
    'balance', v_balance,
    'claimedAt', v_claim.claimed_at,
    'nextClaimAt', v_next
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. My claim today (drives the countdown on the coins page)
-- ---------------------------------------------------------------------------

create or replace function public.my_free_coin_claim()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.free_coin_claims;
  v_today date := (now() at time zone 'UTC')::date;
begin
  if v_uid is null then
    return jsonb_build_object('claimed', false);
  end if;

  select c.*
    into v_claim
    from public.free_coin_claims c
   where c.user_id = v_uid
     and (c.claimed_at at time zone 'UTC')::date = v_today
   order by c.claimed_at desc
   limit 1;

  if not found then
    return jsonb_build_object('claimed', false);
  end if;

  return jsonb_build_object(
    'claimed', true,
    'claimedAt', v_claim.claimed_at,
    'coins', v_claim.coins_given,
    'nextClaimAt', ((v_today + 1)::timestamp at time zone 'UTC')
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Admin: every claim, newest first
-- ---------------------------------------------------------------------------

create or replace function public.admin_free_coin_claims(_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := greatest(1, least(coalesce(_limit, 200), 1000));
  v_rows jsonb;
begin
  if not public.coin_admin_ok() then
    raise exception 'not_admin';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.claimed_at desc), '[]'::jsonb)
    into v_rows
    from (
      select
        c.id,
        c.user_id,
        coalesce(c.username, p.username, p.handle) as username,
        p.avatar_url,
        c.claimed_at,
        c.venmo_clicked,
        c.coins_given
      from public.free_coin_claims c
      left join public.profiles p on p.id = c.user_id
      order by c.claimed_at desc
      limit v_limit
    ) t;

  return v_rows;
end;
$$;

grant execute on function public.claim_free_coins() to authenticated;
grant execute on function public.my_free_coin_claim() to authenticated;
grant execute on function public.admin_free_coin_claims(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime: let the host dashboard hear about new claims
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.free_coin_claims;
    exception when duplicate_object then
      -- Already published; nothing to do.
      null;
    end;
  end if;
end;
$$;
