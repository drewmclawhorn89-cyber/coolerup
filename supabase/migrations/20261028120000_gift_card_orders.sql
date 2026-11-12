-- Gift card orders
--
-- One row per gift card purchase. Rows are created by the server function
-- (service role) after a successful charge, so the buyer can always see what
-- they bought even if fulfilment is still in flight.
--
-- status:
--   pending   -> charged (or recorded), waiting on the fulfilment provider
--   delivered -> provider returned a code
--   failed    -> provider rejected the order (refund path)

create table if not exists public.gift_card_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  card_id text not null,
  card_name text not null,
  amount_cents integer not null check (amount_cents > 0),
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending', 'delivered', 'failed')),
  code text,
  redemption_url text,
  provider_order_id text,
  payment_intent_id text,
  created_at timestamptz not null default now()
);

create index if not exists gift_card_orders_user_idx
  on public.gift_card_orders (user_id, created_at desc);

alter table public.gift_card_orders enable row level security;

-- Buyers can read their own orders. Nobody can insert/update from the client:
-- only the server function (service role, which bypasses RLS) writes here.
drop policy if exists "gift card orders are readable by their owner" on public.gift_card_orders;
create policy "gift card orders are readable by their owner"
  on public.gift_card_orders
  for select
  to authenticated
  using (auth.uid() = user_id);
