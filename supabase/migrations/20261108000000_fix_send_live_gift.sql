-- Fix: every gift send failed with
--   ERROR: column reference "balance" is ambiguous
--
-- send_live_gift() is declared `returns table (gift_id uuid, balance integer)`.
-- In PL/pgSQL the OUT parameters of a `returns table` function become ordinary
-- variables inside the body, so the parameter named `balance` shadowed the
-- `balance` column of public.user_coins. The UPDATE below then could not tell
-- which one was meant:
--
--   update public.user_coins
--      set balance = balance - p_coins        -- ambiguous
--    where user_id = v_sender
--      and balance >= p_coins                 -- ambiguous
--
-- The body is re-created here with every column reference qualified through a
-- table alias, which removes the ambiguity without changing the function's
-- signature, its return shape, or its behaviour. `create or replace function`
-- keeps the existing grants in place, and the signature is identical so the
-- client call site (supabase.rpc("send_live_gift", ...)) needs no change.
--
-- Strictly a bug fix: no table, row, policy or signature is altered.

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

  -- `uc.` qualification is the fix: it keeps the OUT parameter named `balance`
  -- from shadowing the column of the same name.
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

  -- Streamer earns diamonds at 100 coins = 50 diamonds.
  v_diamonds := p_coins / 2;

  insert into public.user_coins as uc (user_id, balance, total_earned, diamonds)
  values (p_receiver_id, 0, p_coins, v_diamonds)
  on conflict (user_id) do update
    set total_earned = uc.total_earned + excluded.total_earned,
        diamonds = uc.diamonds + excluded.diamonds,
        updated_at = now();

  return query select v_gift_id, v_balance;
end;
$$;

revoke all on function public.send_live_gift(text, uuid, text, integer, integer) from public;
grant execute on function public.send_live_gift(text, uuid, text, integer, integer) to authenticated;
