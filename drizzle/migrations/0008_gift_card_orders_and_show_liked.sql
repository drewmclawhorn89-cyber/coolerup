create table if not exists public.gift_card_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  card_id text not null,
  card_name text not null,
  amount_cents integer not null check (amount_cents > 0),
  recipient_email text not null,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  code text, redemption_url text, provider_order_id text, payment_intent_id text,
  created_at timestamptz not null default now()
);
grant select on public.gift_card_orders to authenticated;
grant all on public.gift_card_orders to service_role;
create index if not exists gift_card_orders_user_idx on public.gift_card_orders (user_id, created_at desc);
alter table public.gift_card_orders enable row level security;
drop policy if exists "gift card orders are readable by their owner" on public.gift_card_orders;
create policy "gift card orders are readable by their owner" on public.gift_card_orders for select to authenticated using (auth.uid() = user_id);
alter table public.profiles add column if not exists show_liked boolean not null default true;