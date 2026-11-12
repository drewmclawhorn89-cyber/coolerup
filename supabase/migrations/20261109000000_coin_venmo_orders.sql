-- ---------------------------------------------------------------------------
-- Venmo coin purchases
--
-- Stripe Checkout needs a secret key and a merchant account. Until that is set
-- up, coins are bought by sending money to the Coolerup Venmo account with a
-- short order code in the payment note. The flow is:
--
--   1. `createCoinVenmoOrder` (server) writes an `awaiting_payment` row with a
--      unique reference code such as CU-7K3QX9 and returns a Venmo pay link
--      pre-filled with the amount and the code.
--   2. The buyer pays in Venmo and comes back.
--   3. `submit_coin_venmo_payment` moves the order to `submitted` with the
--      Venmo username / transaction id they typed in.
--   4. An admin checks the Venmo balance and calls
--      `admin_review_coin_venmo_order(order, 'approve')`, which credits the
--      wallet exactly once and writes a normal `coin_purchases` ledger row.
--
-- Every function returns jsonb rather than `returns table (...)` on purpose:
-- OUT parameters become PL/pgSQL variables and shadow column names, which is
-- what broke `send_live_gift`.
-- ---------------------------------------------------------------------------

create table if not exists public.coin_venmo_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  pack_id text not null,
  coins integer not null check (coins > 0),
  amount_cents integer not null check (amount_cents > 0),
  -- Short code the buyer puts in the Venmo note so the payment can be matched.
  reference_code text not null unique,
  -- awaiting_payment -> submitted -> paid | rejected. `canceled` is user opt-out.
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment', 'submitted', 'paid', 'rejected', 'canceled')),
  -- What the buyer told us: their Venmo username and any note / txn id.
  payer_handle text,
  venmo_note text,
  -- What the admin said when reviewing.
  admin_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists coin_venmo_orders_user_idx
  on public.coin_venmo_orders (user_id, created_at desc);

create index if not exists coin_venmo_orders_status_idx
  on public.coin_venmo_orders (status, created_at desc);

alter table public.coin_venmo_orders enable row level security;

-- Buyers can read their own orders (so the recharge page can show status).
-- Writes go through the security-definer functions below, so there are no
-- insert/update/delete policies: nobody can credit themselves.
drop policy if exists "buyers read own venmo orders" on public.coin_venmo_orders;
create policy "buyers read own venmo orders" on public.coin_venmo_orders
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Admin check
--
-- `am_i_admin()` exists in the live database but is not created by any
-- migration in this repo, so resolve it defensively: a fresh database should
-- still apply this file cleanly, it just has no admins yet.
-- ---------------------------------------------------------------------------

create or replace function public.coin_admin_ok()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if to_regprocedure('public.am_i_admin()') is null then
    return false;
  end if;
  return coalesce(public.am_i_admin(), false);
exception when others then
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Buyer: mark an order as paid-in-Venmo so an admin can review it
-- ---------------------------------------------------------------------------

create or replace function public.submit_coin_venmo_payment(
  _order_id uuid,
  _payer_handle text,
  _venmo_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.coin_venmo_orders;
  v_handle text;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Sign in first');
  end if;

  v_handle := nullif(regexp_replace(coalesce(_payer_handle, ''), '^@+', ''), '');
  if v_handle is null then
    return jsonb_build_object('ok', false, 'error', 'Enter the Venmo username you paid from');
  end if;

  update public.coin_venmo_orders o
     set status = 'submitted',
         payer_handle = v_handle,
         venmo_note = nullif(btrim(coalesce(_venmo_note, '')), ''),
         updated_at = now()
   where o.id = _order_id
     and o.user_id = auth.uid()
     and o.status in ('awaiting_payment', 'rejected')
  returning * into v_order;

  if v_order.id is null then
    select * into v_order
      from public.coin_venmo_orders o
     where o.id = _order_id and o.user_id = auth.uid();

    if v_order.id is null then
      return jsonb_build_object('ok', false, 'error', 'Order not found');
    end if;
    if v_order.status = 'paid' then
      return jsonb_build_object('ok', true, 'alreadyPaid', true, 'status', 'paid');
    end if;
    return jsonb_build_object(
      'ok', false,
      'error', 'That order is already ' || v_order.status
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', v_order.status,
    'referenceCode', v_order.reference_code
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Buyer: list my orders
-- ---------------------------------------------------------------------------

create or replace function public.my_coin_venmo_orders()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select o.id,
             o.pack_id,
             o.coins,
             o.amount_cents,
             o.reference_code,
             o.status,
             o.payer_handle,
             o.venmo_note,
             o.admin_note,
             o.created_at,
             o.updated_at
        from public.coin_venmo_orders o
       where o.user_id = auth.uid()
       order by o.created_at desc
       limit 25
    ) t;

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: review queue
-- ---------------------------------------------------------------------------

create or replace function public.admin_coin_venmo_orders(_limit integer default 200)
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
    raise exception 'Admins only';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select o.id,
             o.user_id,
             p.handle as username,
             o.pack_id,
             o.coins,
             o.amount_cents,
             o.reference_code,
             o.status,
             o.payer_handle,
             o.venmo_note,
             o.admin_note,
             o.reviewed_at,
             o.created_at
        from public.coin_venmo_orders o
        left join public.profiles p on p.id = o.user_id
       order by
         case o.status when 'submitted' then 0 when 'awaiting_payment' then 1 else 2 end,
         o.created_at desc
       limit greatest(1, least(coalesce(_limit, 200), 500))
    ) t;

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: approve (credit coins once) or reject
-- ---------------------------------------------------------------------------

create or replace function public.admin_review_coin_venmo_order(
  _order_id uuid,
  _action text,
  _note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.coin_venmo_orders;
  v_balance integer;
  v_note text;
begin
  if not public.coin_admin_ok() then
    raise exception 'Admins only';
  end if;

  if _action is null or _action not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'Action must be approve or reject');
  end if;

  v_note := nullif(btrim(coalesce(_note, '')), '');

  if _action = 'reject' then
    update public.coin_venmo_orders o
       set status = 'rejected',
           admin_note = coalesce(v_note, o.admin_note),
           reviewed_by = auth.uid(),
           reviewed_at = now(),
           updated_at = now()
     where o.id = _order_id
       and o.status in ('awaiting_payment', 'submitted')
    returning * into v_order;

    if v_order.id is null then
      select * into v_order from public.coin_venmo_orders o where o.id = _order_id;
      if v_order.id is null then
        return jsonb_build_object('ok', false, 'error', 'Order not found');
      end if;
      return jsonb_build_object('ok', false, 'error', 'That order is already ' || v_order.status);
    end if;

    return jsonb_build_object('ok', true, 'status', 'rejected');
  end if;

  -- Approve. Claim the row first so two admins clicking at once cannot credit
  -- the wallet twice.
  update public.coin_venmo_orders o
     set status = 'paid',
         admin_note = coalesce(v_note, o.admin_note),
         reviewed_by = auth.uid(),
         reviewed_at = now(),
         updated_at = now()
   where o.id = _order_id
     and o.status in ('awaiting_payment', 'submitted')
  returning * into v_order;

  if v_order.id is null then
    select * into v_order from public.coin_venmo_orders o where o.id = _order_id;
    if v_order.id is null then
      return jsonb_build_object('ok', false, 'error', 'Order not found');
    end if;
    if v_order.status = 'paid' then
      return jsonb_build_object('ok', true, 'alreadyPaid', true, 'coins', v_order.coins);
    end if;
    return jsonb_build_object('ok', false, 'error', 'That order is ' || v_order.status);
  end if;

  insert into public.user_coins as uc (user_id, balance, total_recharged, updated_at)
  values (v_order.user_id, v_order.coins, v_order.coins, now())
  on conflict (user_id) do update
     set balance = uc.balance + excluded.balance,
         total_recharged = uc.total_recharged + excluded.total_recharged,
         updated_at = now()
  returning uc.balance into v_balance;

  -- One ledger for both rails: Stripe rows use `cs_...`, Venmo rows use
  -- `venmo:<code>`, and the unique constraint makes this insert idempotent.
  insert into public.coin_purchases
    (user_id, pack_id, coins, amount_cents, status, stripe_session_id, paid_at)
  values
    (v_order.user_id, v_order.pack_id, v_order.coins, v_order.amount_cents,
     'paid', 'venmo:' || v_order.reference_code, now())
  on conflict (stripe_session_id) do nothing;

  return jsonb_build_object(
    'ok', true,
    'status', 'paid',
    'coins', v_order.coins,
    'balance', v_balance
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant execute on function public.submit_coin_venmo_payment(uuid, text, text) to authenticated;
grant execute on function public.my_coin_venmo_orders() to authenticated;
grant execute on function public.admin_coin_venmo_orders(integer) to authenticated;
grant execute on function public.admin_review_coin_venmo_order(uuid, text, text) to authenticated;
grant execute on function public.coin_admin_ok() to authenticated;

-- Live updates so the recharge page can flip an order to "paid" without a
-- refresh. Guarded so re-running the migration is safe.
do $$
begin
  alter publication supabase_realtime add table public.coin_venmo_orders;
exception when others then
  null;
end $$;
