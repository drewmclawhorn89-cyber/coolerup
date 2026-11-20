-- 20261211000000_user_presence.sql
--
-- TikTok-style online status (`is_online`, `last_active`, `show_online`)
-- with reciprocal privacy enforcement and no location/PII fields.

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  handle text not null unique,
  is_online boolean not null default false,
  last_active timestamptz not null default now(),
  show_online boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists user_presence_handle_idx on public.user_presence (handle);

alter table public.user_presence enable row level security;

drop policy if exists "Visible online status is readable" on public.user_presence;
create policy "Visible online status is readable"
  on public.user_presence
  for select
  to anon, authenticated
  using (show_online = true or auth.uid() = user_id);

drop policy if exists "Users can insert own online status" on public.user_presence;
create policy "Users can insert own online status"
  on public.user_presence
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own online status" on public.user_presence;
create policy "Users can update own online status"
  on public.user_presence
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own online status" on public.user_presence;
create policy "Users can delete own online status"
  on public.user_presence
  for delete
  to authenticated
  using (auth.uid() = user_id);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.user_presence;
    exception when duplicate_object then
      null;
    end;
  end if;
end $$;
