-- ---------------------------------------------------------------------------
-- Creator fund: $1.00 real money for reaching your first follower
--
-- The reward is granted by a trigger on `follows`, not by the client. That
-- matters: the client can be modified, the database cannot. A follow row is the
-- only thing that can trigger the payout, so the money is always backed by a
-- real relationship.
--
-- Anti-abuse rules, all enforced in SQL:
--   * self-follows never count (same user id, or same handle);
--   * the follower must be a real profile (follower_id resolves);
--   * the reward fires only when the follower count is exactly 1, i.e. the
--     first time the account reaches its first follower;
--   * a unique index on follower_rewards(user_id) makes "once per account,
--     ever" true even under a race, so unfollowing down to 0 and back to 1
--     cannot pay twice.
--
-- Money lives in `user_balance.real_balance` (USD, 2dp) and is separate from
-- the coin wallet so cashable earnings can never be spent on gifts.
--
-- Every function returns jsonb rather than `returns table (...)` on purpose:
-- OUT parameters become PL/pgSQL variables and shadow column names, which is
-- what broke `send_live_gift`.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.follower_rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  username text,
  follower_count integer not null default 1,
  reward_amount numeric(10, 2) not null default 1.00 check (reward_amount >= 0),
  -- `claimed` means "paid out by an admin", matching the admin Pay button.
  claimed boolean not null default false,
  created_at timestamptz not null default now(),
  -- Set once the in-app celebration has been shown, so it never nags twice.
  notified boolean not null default false,
  -- Cashout request: the user tapped "Cash out via Venmo".
  payout_requested_at timestamptz,
  payout_venmo_handle text,
  -- Payout bookkeeping written by an admin.
  paid_at timestamptz,
  paid_by uuid,
  payout_method text,
  payout_note text
);

-- One first-follower reward per account, forever. This is the real guard
-- against unfollow/refollow farming; the trigger check is only a fast path.
create unique index if not exists follower_rewards_one_per_user_idx
  on public.follower_rewards (user_id);

create index if not exists follower_rewards_created_idx
  on public.follower_rewards (created_at desc);

create index if not exists follower_rewards_claimed_idx
  on public.follower_rewards (claimed, created_at desc);

create table if not exists public.user_balance (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  -- Cashable earnings in USD. Never negative: an admin can't claw back below 0.
  real_balance numeric(10, 2) not null default 0.00 check (real_balance >= 0),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row level security
--
-- Users read their own rows. All writes go through the security-definer
-- functions below, so there are no insert/update policies: nobody can credit
-- themselves a balance.
-- ---------------------------------------------------------------------------

alter table public.follower_rewards enable row level security;
alter table public.user_balance enable row level security;

drop policy if exists "users read own follower rewards" on public.follower_rewards;
create policy "users read own follower rewards" on public.follower_rewards
  for select using (user_id = auth.uid());

drop policy if exists "users read own real balance" on public.user_balance;
create policy "users read own real balance" on public.user_balance
  for select using (user_id = auth.uid());

-- Admin policies are created only when the admin helper exists, so this file
-- still applies cleanly on a fresh database that has no admins yet.
do $$
begin
  if to_regprocedure('public.coin_admin_ok()') is not null then
    execute $p$
      drop policy if exists "admins read all follower rewards" on public.follower_rewards;
      create policy "admins read all follower rewards" on public.follower_rewards
        for select using (public.coin_admin_ok());
    $p$;
    execute $p$
      drop policy if exists "admins update follower rewards" on public.follower_rewards;
      create policy "admins update follower rewards" on public.follower_rewards
        for update using (public.coin_admin_ok());
    $p$;
    execute $p$
      drop policy if exists "admins read all real balances" on public.user_balance;
      create policy "admins read all real balances" on public.user_balance
        for select using (public.coin_admin_ok());
    $p$;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- Award the reward
--
-- Internal helper. Idempotent: the unique index decides, and a losing insert
-- simply reports "already awarded" instead of paying twice.
-- ---------------------------------------------------------------------------

create or replace function public.award_first_follower_reward(
  _user_id uuid,
  _username text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount numeric(10, 2) := 1.00;
  v_reward_id uuid;
  v_balance numeric(10, 2);
  v_name text;
begin
  if _user_id is null then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'Missing user');
  end if;

  -- One reward per account, ever.
  if exists (select 1 from public.follower_rewards r where r.user_id = _user_id) then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'already_awarded');
  end if;

  v_name := nullif(btrim(coalesce(_username, '')), '');
  if v_name is null then
    select coalesce(p.username, p.handle) into v_name from public.profiles p where p.id = _user_id;
  end if;

  insert into public.follower_rewards (user_id, username, follower_count, reward_amount, claimed)
  values (_user_id, v_name, 1, v_amount, false)
  on conflict (user_id) do nothing
  returning id into v_reward_id;

  -- Lost the race: another insert already paid this account.
  if v_reward_id is null then
    return jsonb_build_object('ok', true, 'awarded', false, 'reason', 'already_awarded');
  end if;

  insert into public.user_balance as ub (user_id, real_balance, updated_at)
  values (_user_id, v_amount, now())
  on conflict (user_id) do update
    set real_balance = ub.real_balance + v_amount,
        updated_at = now()
  returning ub.real_balance into v_balance;

  return jsonb_build_object(
    'ok', true,
    'awarded', true,
    'rewardId', v_reward_id,
    'rewardAmount', v_amount,
    'realBalance', v_balance,
    'username', v_name
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: a new follow may be the first follower
-- ---------------------------------------------------------------------------

create or replace function public.tg_follows_award_first_follower()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_target_id uuid;
  v_target_name text;
  v_follower_exists boolean;
  v_count integer;
begin
  -- Anonymous follows can't be verified, so they never pay out.
  if new.follower_id is null then
    return new;
  end if;

  -- Resolve the followed account. `follows` stores handles, not ids.
  select p.id, coalesce(p.username, p.handle)
    into v_target_id, v_target_name
  from public.profiles p
  where p.handle = new.following_username
  limit 1;

  if v_target_id is null then
    return new;
  end if;

  -- No self-follow, by id or by handle.
  if v_target_id = new.follower_id
     or lower(btrim(new.follower_username)) = lower(btrim(new.following_username)) then
    return new;
  end if;

  -- The follower must be a real account, not a spoofed handle.
  select exists (select 1 from public.profiles p where p.id = new.follower_id)
    into v_follower_exists;
  if not v_follower_exists then
    return new;
  end if;

  -- Only the moment the account reaches its first follower counts.
  select count(*) into v_count
  from public.follows f
  where f.following_username = new.following_username;

  if v_count <> 1 then
    return new;
  end if;

  perform public.award_first_follower_reward(v_target_id, v_target_name);
  return new;
end;
$$;

drop trigger if exists follows_award_first_follower on public.follows;
create trigger follows_award_first_follower
  after insert on public.follows
  for each row
  execute function public.tg_follows_award_first_follower();

-- ---------------------------------------------------------------------------
-- Client: read my reward / balance
-- ---------------------------------------------------------------------------

create or replace function public.my_follower_reward()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.follower_rewards;
  v_balance numeric(10, 2);
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in first');
  end if;

  select * into v_row
  from public.follower_rewards
  where user_id = auth.uid()
  limit 1;

  select coalesce(real_balance, 0) into v_balance
  from public.user_balance
  where user_id = auth.uid();

  if v_row.id is null then
    return jsonb_build_object(
      'ok', true,
      'awarded', false,
      'realBalance', coalesce(v_balance, 0)
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'awarded', true,
    'rewardId', v_row.id,
    'username', v_row.username,
    'followerCount', v_row.follower_count,
    'rewardAmount', v_row.reward_amount,
    'claimed', v_row.claimed,
    'createdAt', v_row.created_at,
    'payoutRequestedAt', v_row.payout_requested_at,
    'payoutVenmoHandle', v_row.payout_venmo_handle,
    'paidAt', v_row.paid_at,
    'realBalance', coalesce(v_balance, 0)
  );
end;
$$;

/**
 * Hand the celebration to the app exactly once. Returns the reward the first
 * time it is called after a payout, then `{awarded:false}` forever after.
 */
create or replace function public.take_follower_reward_notice()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.follower_rewards;
  v_balance numeric(10, 2);
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'awarded', false, 'error', 'Sign in first');
  end if;

  select * into v_row
  from public.follower_rewards
  where user_id = auth.uid() and notified = false
  order by created_at asc
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', true, 'awarded', false);
  end if;

  update public.follower_rewards
    set notified = true
  where id = v_row.id;

  select coalesce(real_balance, 0) into v_balance
  from public.user_balance
  where user_id = auth.uid();

  return jsonb_build_object(
    'ok', true,
    'awarded', true,
    'rewardId', v_row.id,
    'rewardAmount', v_row.reward_amount,
    'username', v_row.username,
    'realBalance', coalesce(v_balance, 0)
  );
end;
$$;

create or replace function public.my_real_balance()
returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_balance numeric(10, 2);
begin
  if auth.uid() is null then
    return 0;
  end if;
  select coalesce(real_balance, 0) into v_balance
  from public.user_balance
  where user_id = auth.uid();
  return coalesce(v_balance, 0);
end;
$$;

-- ---------------------------------------------------------------------------
-- Client: request a manual Venmo payout
--
-- There is no payout API, so this only records intent. An admin sends the
-- money by hand and marks the row paid, which is the audit trail.
-- ---------------------------------------------------------------------------

create or replace function public.request_follower_payout(_venmo_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.follower_rewards;
  v_handle text;
  v_balance numeric(10, 2);
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in first');
  end if;

  v_handle := nullif(regexp_replace(btrim(coalesce(_venmo_handle, '')), '^@+', ''), '');
  if v_handle is null or v_handle !~ '^[A-Za-z0-9_-]{3,30}$' then
    return jsonb_build_object('ok', false, 'error', 'Enter your Venmo username');
  end if;

  select * into v_row
  from public.follower_rewards
  where user_id = auth.uid()
  limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'Get your first follower to unlock cashout');
  end if;

  if v_row.claimed then
    return jsonb_build_object('ok', false, 'error', 'This reward was already paid out');
  end if;

  select coalesce(real_balance, 0) into v_balance
  from public.user_balance
  where user_id = auth.uid();

  -- Minimum $1.00 to cash out.
  if coalesce(v_balance, 0) < 1 then
    return jsonb_build_object('ok', false, 'error', 'You need at least $1.00 to cash out');
  end if;

  update public.follower_rewards
    set payout_requested_at = coalesce(payout_requested_at, now()),
        payout_venmo_handle = v_handle
  where id = v_row.id;

  return jsonb_build_object(
    'ok', true,
    'rewardId', v_row.id,
    'amount', v_row.reward_amount,
    'venmoHandle', v_handle,
    'realBalance', v_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: payout queue
-- ---------------------------------------------------------------------------

create or replace function public.admin_follower_payouts(_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.coin_admin_ok() then
    raise exception 'not_admin';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_rows
  from (
    select
      r.id,
      r.user_id,
      coalesce(p.username, p.handle, r.username) as username,
      p.display_name,
      p.avatar_url,
      r.follower_count,
      r.reward_amount,
      r.claimed,
      r.created_at,
      r.payout_requested_at,
      r.payout_venmo_handle,
      r.paid_at,
      r.payout_note,
      coalesce(ub.real_balance, 0) as real_balance
    from public.follower_rewards r
    left join public.profiles p on p.id = r.user_id
    left join public.user_balance ub on ub.user_id = r.user_id
    order by r.created_at desc
    limit greatest(1, least(coalesce(_limit, 200), 1000))
  ) t;

  return v_rows;
end;
$$;

create or replace function public.admin_mark_payout_paid(
  _reward_id uuid,
  _note text default null,
  _method text default 'venmo'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.follower_rewards;
begin
  if not public.coin_admin_ok() then
    raise exception 'not_admin';
  end if;

  select * into v_row from public.follower_rewards where id = _reward_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'Reward not found');
  end if;

  if v_row.claimed then
    return jsonb_build_object('ok', true, 'alreadyPaid', true, 'paidAt', v_row.paid_at);
  end if;

  update public.follower_rewards
    set claimed = true,
        paid_at = now(),
        paid_by = auth.uid(),
        payout_method = coalesce(nullif(btrim(coalesce(_method, '')), ''), 'venmo'),
        payout_note = nullif(btrim(coalesce(_note, '')), '')
  where id = _reward_id
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'alreadyPaid', false,
    'rewardId', v_row.id,
    'paidAt', v_row.paid_at,
    'amount', v_row.reward_amount
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants + realtime
-- ---------------------------------------------------------------------------

grant execute on function public.my_follower_reward() to authenticated;
grant execute on function public.take_follower_reward_notice() to authenticated;
grant execute on function public.my_real_balance() to authenticated;
grant execute on function public.request_follower_payout(text) to authenticated;
grant execute on function public.admin_follower_payouts(integer) to authenticated;
grant execute on function public.admin_mark_payout_paid(uuid, text, text) to authenticated;

-- Realtime lets the celebration pop the instant the follow lands. Best-effort:
-- the app also claims the notice on mount and on focus.
do $$
begin
  alter publication supabase_realtime add table public.follower_rewards;
exception
  when duplicate_object then null;
  when undefined_object then null;
end
$$;
