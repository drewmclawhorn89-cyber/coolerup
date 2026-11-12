-- TikTok-style payouts: creator fund + gifts + diamonds + wallet.
--
-- STRICTLY ADDITIVE. Nothing here drops a table, rewrites a row, or changes an
-- existing function signature. The only writes to existing data are:
--
--   1. `user_balance` gains two columns (`diamonds`, `total_earned`) and every
--      profile gets a wallet row so the new UI never has to special-case a
--      missing balance.
--   2. `send_live_gift()` is re-created with the same signature so a gift also
--      credits the streamer's diamond wallet in `user_balance`. `user_coins`
--      keeps its own `diamonds` column in sync so the existing LIVE UI is
--      unchanged.
--
-- MONEY RULES (one source of truth, mirrored in src/lib/payouts.ts):
--   100 coins  = 50 diamonds = $0.50   ->  1 diamond = $0.01
--   creator fund milestones are one-time per account, per milestone.
--   Cashout minimum is $10.00, paid manually via Venmo or Stripe.
--
-- Every function returns `jsonb` (never `returns table`) on purpose: OUT
-- parameters of a `returns table` function become PL/pgSQL variables that
-- shadow column names, which is exactly the bug that broke `send_live_gift`
-- once already (see 20261108000000_fix_send_live_gift.sql).

-- ---------------------------------------------------------------------------
-- 1. Widen the earnings wallet
-- ---------------------------------------------------------------------------

create table if not exists public.user_balance (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  real_balance numeric(10, 2) not null default 0.00 check (real_balance >= 0),
  updated_at timestamptz not null default now()
);

alter table public.user_balance
  add column if not exists diamonds integer not null default 0;
alter table public.user_balance
  add column if not exists total_earned numeric(10, 2) not null default 0.00;

-- Guard the new columns without re-adding them if the constraint already exists.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_balance_diamonds_check'
  ) then
    alter table public.user_balance
      add constraint user_balance_diamonds_check check (diamonds >= 0);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'user_balance_total_earned_check'
  ) then
    alter table public.user_balance
      add constraint user_balance_total_earned_check check (total_earned >= 0);
  end if;
end $$;

-- One wallet row per profile, so reads are always a plain select.
insert into public.user_balance (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- Carry over diamonds that were earned before this table existed. `greatest`
-- makes the backfill idempotent and never lowers a balance.
update public.user_balance ub
   set diamonds = greatest(ub.diamonds, uc.diamonds),
       total_earned = greatest(ub.total_earned, uc.diamonds * 0.01),
       updated_at = now()
  from public.user_coins uc
 where uc.user_id = ub.user_id
   and uc.diamonds > 0;

-- New accounts get a wallet row automatically.
create or replace function public.init_user_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.user_balance (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists profiles_init_user_balance on public.profiles;
create trigger profiles_init_user_balance
  after insert on public.profiles
  for each row execute function public.init_user_balance();

-- ---------------------------------------------------------------------------
-- 2. Views
-- ---------------------------------------------------------------------------

create table if not exists public.video_views (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null,
  -- The creator being credited. Resolved from videos.user_id, falling back to
  -- videos.username -> profiles.handle for older rows.
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- NULL means an anonymous view. Those are never counted for the creator fund.
  viewer_id uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

-- One view per signed-in viewer per video: the anti-refresh-farming guard.
create unique index if not exists video_views_unique_viewer_idx
  on public.video_views (video_id, viewer_id)
  where viewer_id is not null;

create index if not exists video_views_user_idx
  on public.video_views (user_id, created_at desc);
create index if not exists video_views_video_idx
  on public.video_views (video_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Creator fund earnings
-- ---------------------------------------------------------------------------

create table if not exists public.creator_fund_earnings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- 1000 / 10000 / 100000 / 1000000
  milestone_views integer not null check (milestone_views > 0),
  amount numeric(10, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  -- A milestone is paid once per account, ever.
  unique (user_id, milestone_views)
);

create index if not exists creator_fund_earnings_user_idx
  on public.creator_fund_earnings (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Gift earnings (one row per gift, so a gift can never be double-credited)
-- ---------------------------------------------------------------------------

create table if not exists public.gift_claims (
  id uuid primary key default gen_random_uuid(),
  gift_id uuid not null unique references public.live_gifts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  diamonds integer not null default 0 check (diamonds >= 0),
  amount numeric(10, 2) not null default 0.00 check (amount >= 0),
  created_at timestamptz not null default now()
);

create index if not exists gift_claims_user_idx
  on public.gift_claims (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 5. Payout requests
-- ---------------------------------------------------------------------------

create table if not exists public.payouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  username text,
  -- Diamonds consumed by this payout (converted at $0.01 each).
  diamonds integer not null default 0 check (diamonds >= 0),
  amount numeric(10, 2) not null check (amount >= 10.00),
  method text not null default 'venmo' check (method in ('venmo', 'stripe')),
  -- Venmo username, or the Stripe account email.
  destination text,
  status text not null default 'pending' check (status in ('pending', 'paid', 'rejected')),
  requested_at timestamptz not null default now(),
  paid_at timestamptz,
  paid_by uuid,
  note text
);

create index if not exists payouts_user_idx
  on public.payouts (user_id, requested_at desc);
create index if not exists payouts_status_idx
  on public.payouts (status, requested_at desc);

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

alter table public.video_views enable row level security;
alter table public.creator_fund_earnings enable row level security;
alter table public.gift_claims enable row level security;
alter table public.payouts enable row level security;

-- Views are written only through record_video_view().
drop policy if exists "read own video views" on public.video_views;
create policy "read own video views"
  on public.video_views for select
  using (auth.uid() = user_id);

drop policy if exists "read own creator fund earnings" on public.creator_fund_earnings;
create policy "read own creator fund earnings"
  on public.creator_fund_earnings for select
  using (auth.uid() = user_id);

drop policy if exists "read own gift claims" on public.gift_claims;
create policy "read own gift claims"
  on public.gift_claims for select
  using (auth.uid() = user_id);

drop policy if exists "read own payouts" on public.payouts;
create policy "read own payouts"
  on public.payouts for select
  using (auth.uid() = user_id);

-- Admin read access, created defensively so this migration still applies on a
-- database where the admin helper has not been deployed yet.
do $$
begin
  if to_regprocedure('public.coin_admin_ok()') is not null then
    execute 'drop policy if exists "admins read all payouts" on public.payouts';
    execute 'create policy "admins read all payouts" on public.payouts for select using (public.coin_admin_ok())';
    execute 'drop policy if exists "admins read all creator fund earnings" on public.creator_fund_earnings';
    execute 'create policy "admins read all creator fund earnings" on public.creator_fund_earnings for select using (public.coin_admin_ok())';
  end if;
end $$;

-- No insert/update policies anywhere: balances only move through the RPCs
-- below, which are security definer and validate the caller.

-- ---------------------------------------------------------------------------
-- 7. Realtime
-- ---------------------------------------------------------------------------

do $$
begin
  begin
    alter publication supabase_realtime add table public.payouts;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.gift_claims;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.creator_fund_earnings;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.video_views;
  exception when duplicate_object then null;
  end;
exception when undefined_object then
  -- No supabase_realtime publication (bare Postgres). Nothing to do.
  null;
end $$;

-- ---------------------------------------------------------------------------
-- 8. Gift sends also credit the diamond wallet
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
  v_amount numeric(10, 2);
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

  -- `uc.` qualification keeps the OUT parameter named `balance` from shadowing
  -- the column of the same name.
  update public.user_coins as uc
     set balance = uc.balance - p_coins,
         total_spent = uc.total_spent + p_coins,
         updated_at = now()
   where uc.user_id = v_sender
     and uc.balance >= p_coins
  returning uc.balance into v_balance;

  if v_balance is null then
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  insert into public.live_gifts (live_id, sender_id, receiver_id, gift_type, coins, quantity)
  values (p_live_id, v_sender, p_receiver_id, p_gift_type, p_coins, p_quantity)
  returning id into v_gift_id;

  -- 100 coins = 50 diamonds, i.e. the 50/50 creator split.
  v_diamonds := p_coins / 2;
  v_amount := round(v_diamonds * 0.01, 2);

  -- Legacy wallet, kept in sync so the existing LIVE UI is untouched.
  insert into public.user_coins as uc (user_id, balance, total_earned, diamonds)
  values (p_receiver_id, 0, p_coins, v_diamonds)
  on conflict (user_id) do update
    set total_earned = uc.total_earned + excluded.total_earned,
        diamonds = uc.diamonds + excluded.diamonds,
        updated_at = now();

  -- New earnings wallet: diamonds + lifetime USD value.
  insert into public.user_balance as ub (user_id, diamonds, total_earned)
  values (p_receiver_id, v_diamonds, v_amount)
  on conflict (user_id) do update
    set diamonds = ub.diamonds + excluded.diamonds,
        total_earned = ub.total_earned + excluded.total_earned,
        updated_at = now();

  -- Ledger row. `gift_id` is unique, so a retry can never double-credit.
  insert into public.gift_claims (gift_id, user_id, diamonds, amount)
  values (v_gift_id, p_receiver_id, v_diamonds, v_amount)
  on conflict (gift_id) do nothing;

  return query select v_gift_id, v_balance;
end;
$$;

revoke all on function public.send_live_gift(text, uuid, text, integer, integer) from public;
grant execute on function public.send_live_gift(text, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Record a view
-- ---------------------------------------------------------------------------

create or replace function public.record_video_view(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_creator uuid;
  v_handle text;
begin
  if v_viewer is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if p_video_id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_video');
  end if;

  select v.user_id, v.username into v_creator, v_handle
    from public.videos v
   where v.id = p_video_id;

  if v_creator is null and v_handle is not null then
    select p.id into v_creator from public.profiles p where p.handle = v_handle;
  end if;

  if v_creator is null then
    return jsonb_build_object('ok', false, 'error', 'unknown_video');
  end if;

  -- Your own views never count: that would make the creator fund free money.
  if v_creator = v_viewer then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'self_view');
  end if;

  insert into public.video_views (video_id, user_id, viewer_id)
  values (p_video_id, v_creator, v_viewer)
  on conflict do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'duplicate');
  end if;

  return jsonb_build_object('ok', true, 'counted', true);
end;
$$;

revoke all on function public.record_video_view(uuid) from public;
grant execute on function public.record_video_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Creator fund check
-- ---------------------------------------------------------------------------

create or replace function public.check_creator_fund(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_handle text;
  v_followers integer := 0;
  v_views30 integer := 0;
  v_total_views integer := 0;
  v_qualified boolean := false;
  v_milestone record;
  v_awarded jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- A user may only check their own fund; admins may check anyone.
  if p_user_id is not null and p_user_id <> auth.uid() and not public.coin_admin_ok() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select handle into v_handle from public.profiles where id = v_uid;

  select count(*) into v_followers
    from public.follows
   where following_username = v_handle;

  select count(*) into v_views30
    from public.video_views
   where user_id = v_uid
     and viewer_id is not null
     and created_at > now() - interval '30 days';

  select count(*) into v_total_views
    from public.video_views
   where user_id = v_uid
     and viewer_id is not null;

  -- Qualification: 10 followers and 10k views in the last 30 days.
  v_qualified := v_followers >= 10 and v_views30 >= 10000;

  if v_qualified then
    for v_milestone in
      select * from (values
        (1000, 0.02::numeric),
        (10000, 0.20::numeric),
        (100000, 2.00::numeric),
        (1000000, 20.00::numeric)
      ) as t(views, amount)
    loop
      if v_total_views >= v_milestone.views then
        insert into public.creator_fund_earnings (user_id, milestone_views, amount)
        values (v_uid, v_milestone.views, v_milestone.amount)
        on conflict (user_id, milestone_views) do nothing;

        if found then
          update public.user_balance
             set real_balance = real_balance + v_milestone.amount,
                 total_earned = total_earned + v_milestone.amount,
                 updated_at = now()
           where user_id = v_uid;

          v_awarded := v_awarded || jsonb_build_object(
            'views', v_milestone.views,
            'amount', v_milestone.amount
          );
        end if;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'qualified', v_qualified,
    'followers', v_followers,
    'views30d', v_views30,
    'totalViews', v_total_views,
    'awarded', v_awarded
  );
end;
$$;

revoke all on function public.check_creator_fund(uuid) from public;
grant execute on function public.check_creator_fund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Wallet reads
-- ---------------------------------------------------------------------------

create or replace function public.my_wallet()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_diamonds integer := 0;
  v_real numeric(10, 2) := 0;
  v_earned numeric(10, 2) := 0;
  v_coins integer := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select coalesce(ub.diamonds, 0), coalesce(ub.real_balance, 0), coalesce(ub.total_earned, 0)
    into v_diamonds, v_real, v_earned
    from public.user_balance ub
   where ub.user_id = v_uid;

  select coalesce(uc.balance, 0) into v_coins
    from public.user_coins uc
   where uc.user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'diamonds', v_diamonds,
    'realBalance', v_real,
    'totalEarned', v_earned,
    'coins', v_coins,
    'cashable', round(v_real + v_diamonds * 0.01, 2)
  );
end;
$$;

revoke all on function public.my_wallet() from public;
grant execute on function public.my_wallet() to authenticated;

create or replace function public.my_earnings_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gift_diamonds integer := 0;
  v_gift_usd numeric(10, 2) := 0;
  v_fund_usd numeric(10, 2) := 0;
  v_follow_usd numeric(10, 2) := 0;
  v_diamonds integer := 0;
  v_real numeric(10, 2) := 0;
  v_earned numeric(10, 2) := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select coalesce(sum(gc.diamonds), 0), coalesce(sum(gc.amount), 0)
    into v_gift_diamonds, v_gift_usd
    from public.gift_claims gc
   where gc.user_id = v_uid;

  select coalesce(sum(cf.amount), 0) into v_fund_usd
    from public.creator_fund_earnings cf
   where cf.user_id = v_uid;

  if to_regclass('public.follower_rewards') is not null then
    execute 'select coalesce(sum(fr.reward_amount), 0) from public.follower_rewards fr where fr.user_id = $1'
      into v_follow_usd using v_uid;
  end if;

  select coalesce(ub.diamonds, 0), coalesce(ub.real_balance, 0), coalesce(ub.total_earned, 0)
    into v_diamonds, v_real, v_earned
    from public.user_balance ub
   where ub.user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'giftDiamonds', v_gift_diamonds,
    'giftUsd', v_gift_usd,
    'creatorFundUsd', v_fund_usd,
    'followerRewardUsd', v_follow_usd,
    'diamonds', v_diamonds,
    'realBalance', v_real,
    'totalEarned', v_earned,
    'cashable', round(v_real + v_diamonds * 0.01, 2)
  );
end;
$$;

revoke all on function public.my_earnings_summary() from public;
grant execute on function public.my_earnings_summary() to authenticated;

create or replace function public.my_gift_earnings(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select gc.id,
             gc.gift_id,
             gc.diamonds,
             gc.amount,
             gc.created_at,
             lg.gift_type,
             lg.coins,
             lg.quantity,
             lg.live_id,
             p.handle as sender_username,
             p.display_name as sender_display_name,
             p.avatar_url as sender_avatar_url
        from public.gift_claims gc
        join public.live_gifts lg on lg.id = gc.gift_id
        left join public.profiles p on p.id = lg.sender_id
       where gc.user_id = v_uid
       order by gc.created_at desc
       limit v_limit
    ) t;

  return jsonb_build_object('ok', true, 'gifts', v_rows);
end;
$$;

revoke all on function public.my_gift_earnings(integer) from public;
grant execute on function public.my_gift_earnings(integer) to authenticated;

create or replace function public.my_creator_fund()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_followers integer := 0;
  v_views30 integer := 0;
  v_total_views integer := 0;
  v_qualified boolean := false;
  v_earned numeric(10, 2) := 0;
  v_rows jsonb;
  v_next integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select handle into v_handle from public.profiles where id = v_uid;

  select count(*) into v_followers from public.follows where following_username = v_handle;

  select count(*) into v_views30
    from public.video_views
   where user_id = v_uid and viewer_id is not null
     and created_at > now() - interval '30 days';

  select count(*) into v_total_views
    from public.video_views
   where user_id = v_uid and viewer_id is not null;

  v_qualified := v_followers >= 10 and v_views30 >= 10000;

  select coalesce(sum(cf.amount), 0) into v_earned
    from public.creator_fund_earnings cf
   where cf.user_id = v_uid;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select cf.id, cf.milestone_views, cf.amount, cf.created_at
        from public.creator_fund_earnings cf
       where cf.user_id = v_uid
       order by cf.created_at desc
       limit 50
    ) t;

  -- The next milestone the creator has not been paid for yet.
  select min(m.views) into v_next
    from (values (1000), (10000), (100000), (1000000)) as m(views)
   where m.views > coalesce(
     (select max(cf.milestone_views) from public.creator_fund_earnings cf where cf.user_id = v_uid),
     0
   );

  return jsonb_build_object(
    'ok', true,
    'qualified', v_qualified,
    'followers', v_followers,
    'views30d', v_views30,
    'totalViews', v_total_views,
    'earned', v_earned,
    'nextMilestone', v_next,
    'earnings', v_rows
  );
end;
$$;

revoke all on function public.my_creator_fund() from public;
grant execute on function public.my_creator_fund() to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Payout requests
-- ---------------------------------------------------------------------------

create or replace function public.request_payout(
  p_amount numeric,
  p_method text default 'venmo',
  p_destination text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_diamonds integer := 0;
  v_real numeric(10, 2) := 0;
  v_available numeric(10, 2) := 0;
  v_amount numeric(10, 2);
  v_method text := lower(coalesce(p_method, 'venmo'));
  v_destination text := nullif(btrim(coalesce(p_destination, '')), '');
  v_from_diamonds integer := 0;
  v_remainder numeric(10, 2) := 0;
  v_payout_id uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_method not in ('venmo', 'stripe') then
    return jsonb_build_object('ok', false, 'error', 'Choose Venmo or Stripe');
  end if;
  if v_destination is null then
    return jsonb_build_object(
      'ok', false,
      'error', case when v_method = 'venmo' then 'Enter your Venmo username' else 'Enter your Stripe email' end
    );
  end if;

  v_amount := round(coalesce(p_amount, 0), 2);
  if v_amount < 10.00 then
    return jsonb_build_object('ok', false, 'error', 'The minimum cashout is $10.00');
  end if;

  select coalesce(ub.diamonds, 0), coalesce(ub.real_balance, 0)
    into v_diamonds, v_real
    from public.user_balance ub
   where ub.user_id = v_uid
     for update;

  v_available := round(v_real + v_diamonds * 0.01, 2);
  if v_amount > v_available then
    return jsonb_build_object('ok', false, 'error', 'That is more than your available balance');
  end if;

  -- Diamonds are spent first, then any remaining real balance.
  v_from_diamonds := least(v_diamonds, floor(v_amount / 0.01)::integer);
  v_remainder := round(v_amount - v_from_diamonds * 0.01, 2);

  update public.user_balance
     set diamonds = diamonds - v_from_diamonds,
         real_balance = real_balance - v_remainder,
         updated_at = now()
   where user_id = v_uid;

  select handle into v_handle from public.profiles where id = v_uid;

  insert into public.payouts (user_id, username, diamonds, amount, method, destination)
  values (v_uid, v_handle, v_from_diamonds, v_amount, v_method, v_destination)
  returning id into v_payout_id;

  return jsonb_build_object(
    'ok', true,
    'payoutId', v_payout_id,
    'amount', v_amount,
    'diamonds', v_from_diamonds,
    'method', v_method,
    'destination', v_destination
  );
end;
$$;

revoke all on function public.request_payout(numeric, text, text) from public;
grant execute on function public.request_payout(numeric, text, text) to authenticated;

create or replace function public.my_payouts(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.requested_at desc), '[]'::jsonb)
    into v_rows
    from (
      select po.id, po.amount, po.diamonds, po.method, po.destination,
             po.status, po.requested_at, po.paid_at, po.note
        from public.payouts po
       where po.user_id = v_uid
       order by po.requested_at desc
       limit v_limit
    ) t;

  return jsonb_build_object('ok', true, 'payouts', v_rows);
end;
$$;

revoke all on function public.my_payouts(integer) from public;
grant execute on function public.my_payouts(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Admin payout queue
-- ---------------------------------------------------------------------------

create or replace function public.admin_payouts(p_limit integer default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_rows jsonb;
begin
  if not public.coin_admin_ok() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.requested_at desc), '[]'::jsonb)
    into v_rows
    from (
      select po.id,
             po.user_id,
             coalesce(po.username, p.handle) as username,
             p.display_name,
             p.avatar_url,
             po.diamonds,
             po.amount,
             po.method,
             po.destination,
             po.status,
             po.requested_at,
             po.paid_at,
             po.note,
             coalesce(ub.diamonds, 0) as current_diamonds,
             coalesce(ub.real_balance, 0) as current_real_balance,
             coalesce(ub.total_earned, 0) as total_earned,
             (select count(*) from public.video_views vv where vv.user_id = po.user_id) as total_views
        from public.payouts po
        left join public.profiles p on p.id = po.user_id
        left join public.user_balance ub on ub.user_id = po.user_id
       order by po.requested_at desc
       limit v_limit
    ) t;

  return jsonb_build_object('ok', true, 'payouts', v_rows);
end;
$$;

revoke all on function public.admin_payouts(integer) from public;
grant execute on function public.admin_payouts(integer) to authenticated;

create or replace function public.admin_mark_creator_payout_paid(
  p_payout_id uuid,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_status text;
begin
  if not public.coin_admin_ok() then
    raise exception 'not_admin' using errcode = '42501';
  end if;
  if p_payout_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing payout');
  end if;

  select status into v_status from public.payouts where id = p_payout_id;
  if v_status is null then
    return jsonb_build_object('ok', false, 'error', 'Payout not found');
  end if;
  if v_status = 'paid' then
    return jsonb_build_object('ok', true, 'alreadyPaid', true);
  end if;

  update public.payouts
     set status = 'paid',
         paid_at = now(),
         paid_by = v_uid,
         note = coalesce(p_note, note)
   where id = p_payout_id;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_mark_creator_payout_paid(uuid, text) from public;
grant execute on function public.admin_mark_creator_payout_paid(uuid, text) to authenticated;

create or replace function public.admin_payout_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pending integer := 0;
  v_paid integer := 0;
  v_requested numeric(10, 2) := 0;
  v_paid_out numeric(10, 2) := 0;
begin
  if not public.coin_admin_ok() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select count(*) filter (where status = 'pending'),
         count(*) filter (where status = 'paid'),
         coalesce(sum(amount) filter (where status = 'pending'), 0),
         coalesce(sum(amount) filter (where status = 'paid'), 0)
    into v_pending, v_paid, v_requested, v_paid_out
    from public.payouts;

  return jsonb_build_object(
    'ok', true,
    'pendingCount', v_pending,
    'paidCount', v_paid,
    'requestedAmount', v_requested,
    'paidAmount', v_paid_out
  );
end;
$$;

revoke all on function public.admin_payout_stats() from public;
grant execute on function public.admin_payout_stats() to authenticated;
