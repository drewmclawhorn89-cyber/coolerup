create table if not exists public.marketplace_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  seller_username text not null,
  title text not null check (char_length(title) between 1 and 120),
  price numeric(12,2) not null check (price >= 0),
  image_url text,
  location text,
  category text not null default 'Home',
  description text,
  created_at timestamptz not null default now()
);

alter table public.marketplace_items enable row level security;

create policy "Listings are public" on public.marketplace_items for select using (true);
create policy "Users create own listings" on public.marketplace_items for insert to authenticated with check (auth.uid() = user_id);
create policy "Users delete own listings" on public.marketplace_items for delete to authenticated using (auth.uid() = user_id);

insert into storage.buckets (id, name, public) values ('marketplace', 'marketplace', true) on conflict (id) do nothing;

create policy "marketplace upload own folder" on storage.objects for insert to authenticated with check (bucket_id = 'marketplace' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "marketplace read" on storage.objects for select using (bucket_id = 'marketplace');
