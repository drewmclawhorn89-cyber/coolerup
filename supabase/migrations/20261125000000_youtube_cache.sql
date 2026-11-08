create table if not exists public.youtube_cache (
  query text primary key,
  videos jsonb not null default '[]'::jsonb,
  cached_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists youtube_cache_expires_at_idx
  on public.youtube_cache (expires_at);

alter table public.youtube_cache enable row level security;

-- Search results contain only public YouTube metadata. The browser uses the
-- table as a shared one-hour cache; no video files are stored here.
drop policy if exists "public can read YouTube cache" on public.youtube_cache;
create policy "public can read YouTube cache"
  on public.youtube_cache for select
  to anon, authenticated
  using (true);

drop policy if exists "public can insert YouTube cache" on public.youtube_cache;
create policy "public can insert YouTube cache"
  on public.youtube_cache for insert
  to anon, authenticated
  with check (true);

drop policy if exists "public can refresh YouTube cache" on public.youtube_cache;
create policy "public can refresh YouTube cache"
  on public.youtube_cache for update
  to anon, authenticated
  using (true)
  with check (true);
