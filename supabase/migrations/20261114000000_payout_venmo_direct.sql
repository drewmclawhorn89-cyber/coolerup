-- Direct Venmo cashouts.
--
-- Two changes:
--
--   1. Creators save their own Venmo handle once, and cashouts are addressed to
--      that handle instead of the app's account. Before this, the cashout
--      button opened the Coolerup Venmo profile, which is the wrong direction
--      (money must go *to* the creator) and the profile page often fails to
--      load inside a popup.
--
--   2. `request_payout` becomes one-tap: the amount defaults to the full
--      cashable balance and the destination defaults to the saved handle, so
--      the wallet can cash out without a dialog.
--
-- Money safety is unchanged: the wallet row is locked, diamonds are spent
-- before real balance, and the $10 minimum still applies.

-- ---------------------------------------------------------------------------
-- 1. profiles.venmo_handle
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists venmo_handle text;

-- ---------------------------------------------------------------------------
-- 2. Save the caller's handle
-- ---------------------------------------------------------------------------
create or replace function public.set_my_venmo_handle(p_handle text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  -- Venmo usernames are letters, digits, dashes and underscores.
  v_handle := nullif(trim(both from regexp_replace(coalesce(p_handle, ''), '^@+', '')), '');

  if v_handle is null then
    update public.profiles set venmo_handle = null where id = v_uid;
    return jsonb_build_object('ok', true, 'venmoHandle', null);
  end if;

  if v_handle !~ '^[A-Za-z0-9_-]{3,30}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_venmo_handle');
  end if;

  update public.profiles set venmo_handle = v_handle where id = v_uid;

  return jsonb_build_object('ok', true, 'venmoHandle', v_handle);
end;
$$;

revoke all on function public.set_my_venmo_handle(text) from public;
grant execute on function public.set_my_venmo_handle(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. my_wallet: expose the saved handle
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
  v_venmo text;
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

  select p.venmo_handle into v_venmo from public.profiles p where p.id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'diamonds', v_diamonds,
    'realBalance', v_real,
    'totalEarned', v_earned,
    'coins', v_coins,
    'cashable', round(v_real + v_diamonds * 0.01, 2),
    'venmoHandle', v_venmo
  );
end;
$$;

revoke all on function public.my_wallet() from public;
grant execute on function public.my_wallet() to authenticated;

-- ---------------------------------------------------------------------------
-- 4. request_payout: amount and destination are now optional
-- ---------------------------------------------------------------------------
create or replace function public.request_payout(
  p_amount numeric default null,
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
  v_method text := lower(coalesce(nullif(trim(both from p_method), ''), 'venmo'));
  v_destination text;
  v_venmo text;
  v_diamonds integer := 0;
  v_real numeric(10, 2) := 0;
  v_cashable numeric(10, 2) := 0;
  v_amount numeric(10, 2);
  v_from_diamonds integer := 0;
  v_from_real numeric(10, 2) := 0;
  v_payout_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  if v_method not in ('venmo', 'stripe') then
    return jsonb_build_object('ok', false, 'error', 'invalid_method');
  end if;

  -- Lock the wallet so a double tap cannot overdraw it.
  select coalesce(ub.diamonds, 0), coalesce(ub.real_balance, 0)
    into v_diamonds, v_real
    from public.user_balance ub
   where ub.user_id = v_uid
     for update;

  v_cashable := round(v_real + v_diamonds * 0.01, 2);

  -- Default to everything the creator has.
  v_amount := round(coalesce(p_amount, v_cashable), 2);

  if v_amount < 10.00 then
    return jsonb_build_object('ok', false, 'error', 'below_minimum', 'minimum', 10.00);
  end if;

  if v_amount > v_cashable then
    return jsonb_build_object('ok', false, 'error', 'insufficient_balance', 'cashable', v_cashable);
  end if;

  -- Destination: explicit argument, else the saved Venmo handle.
  select p.venmo_handle into v_venmo from public.profiles p where p.id = v_uid;
  v_destination := nullif(trim(both from coalesce(p_destination, '')), '');

  if v_destination is null then
    v_destination := v_venmo;
  end if;

  if v_destination is null then
    return jsonb_build_object('ok', false, 'error', 'venmo_handle_required');
  end if;

  v_destination := regexp_replace(v_destination, '^@+', '');

  -- Spend diamonds first (they are worth $0.01 each), then real balance.
  v_from_diamonds := least(v_diamonds, floor(v_amount / 0.01)::integer);
  v_from_real := round(v_amount - v_from_diamonds * 0.01, 2);

  if v_from_real > v_real then
    -- Rounding pushed us past the real balance; take one more diamond.
    v_from_diamonds := least(v_diamonds, v_from_diamonds + 1);
    v_from_real := greatest(round(v_amount - v_from_diamonds * 0.01, 2), 0);
  end if;

  update public.user_balance
     set diamonds = diamonds - v_from_diamonds,
         real_balance = greatest(real_balance - v_from_real, 0),
         updated_at = now()
   where user_id = v_uid;

  insert into public.payouts (user_id, username, diamonds, amount, method, destination, status)
  select v_uid, p.handle, v_from_diamonds, v_amount, v_method, v_destination, 'pending'
    from public.profiles p
   where p.id = v_uid
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

-- ---------------------------------------------------------------------------
-- 5. admin_payouts: include the saved handle so admins can pay in one click
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
             coalesce(nullif(po.destination, ''), p.venmo_handle) as destination,
             p.venmo_handle,
             po.status,
             po.requested_at,
             po.paid_at,
             po.note,
             coalesce(ub.diamonds, 0) as current_diamonds,
             coalesce(ub.real_balance, 0) as current_real_balance,
             coalesce(ub.total_earned, 0) as total_earned,
             coalesce((
               select sum(vv.views)
                 from public.video_views vv
                where vv.user_id = po.user_id
                  and vv.viewer_id is not null
             ), 0)::integer as total_views
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
