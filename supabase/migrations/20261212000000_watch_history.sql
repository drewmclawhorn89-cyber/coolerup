-- 20261212000000_watch_history.sql
--
-- Account-scoped Watch History and Save Watch History setting,
-- persisted across sessions and logouts with strict owner-only RLS.

create table if not exists public.watch_history (
  user_id uuid not null references public.profiles (id) on delete cascade,
  item_key text not null,
  video_id text not null,
  source text not null check (source in ('foryou', 'videos', 'youtube', 'tiktok', 'instagram')),
  title text not null default '',
  creator text not null default '',
  thumbnail_url text not null default '',
  video_url text not null default '',
  source_url text not null default '',
  watch_route_id text not null default '',
  youtube_id text not null default '',
  watched_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

create index if not exists watch_history_user_watched_idx
  on public.watch_history (user_id, watched_at desc);

alter table public.watch_history enable row level security;

drop policy if exists "Users read own watch history" on public.watch_history;
create policy "Users read own watch history"
  on public.watch_history
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users insert own watch history" on public.watch_history;
create policy "Users insert own watch history"
  on public.watch_history
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own watch history" on public.watch_history;
create policy "Users update own watch history"
  on public.watch_history
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users delete own watch history" on public.watch_history;
create policy "Users delete own watch history"
  on public.watch_history
  for delete
  to authenticated
  using (auth.uid() = user_id);

create table if not exists public.watch_history_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  save_watch_history boolean not null default true,
  updated_at timestamptz not null default now()
);

alter table public.watch_history_settings enable row level security;

drop policy if exists "Users read own watch history settings" on public.watch_history_settings;
create policy "Users read own watch history settings"
  on public.watch_history_settings
  for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users upsert own watch history settings" on public.watch_history_settings;
create policy "Users upsert own watch history settings"
  on public.watch_history_settings
  for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users update own watch history settings" on public.watch_history_settings;
create policy "Users update own watch history settings"
  on public.watch_history_settings
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
