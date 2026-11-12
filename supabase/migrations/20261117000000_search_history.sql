-- ---------------------------------------------------------------------------
-- Search history
--
-- Recent searches for the search tab. One row per (user, query) so re-searching
-- the same thing moves it to the top instead of piling up duplicates.
--
-- `query` keeps the casing the person typed (that's what we show back to them);
-- `query_key` is the normalised lower/trimmed form and is what the unique index
-- is built on, so "Cats" and "cats" are the same entry. PostgREST can only
-- upsert on real columns, which is why the key is a stored generated column
-- rather than a `lower(query)` expression index.
--
-- RLS is per-user: you can only ever read, write or delete your own history.
-- ---------------------------------------------------------------------------

create table if not exists public.search_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  query text not null check (char_length(btrim(query)) between 1 and 120),
  query_key text generated always as (lower(btrim(query))) stored,
  created_at timestamptz not null default now()
);

-- One row per user per normalised query: re-searching refreshes created_at.
create unique index if not exists search_history_user_query_idx
  on public.search_history (user_id, query_key);

-- "Recent searches" is always `order by created_at desc limit 10`.
create index if not exists search_history_user_recent_idx
  on public.search_history (user_id, created_at desc);

alter table public.search_history enable row level security;

drop policy if exists "read own search history" on public.search_history;
create policy "read own search history" on public.search_history
  for select using (user_id = auth.uid());

drop policy if exists "insert own search history" on public.search_history;
create policy "insert own search history" on public.search_history
  for insert with check (user_id = auth.uid());

drop policy if exists "update own search history" on public.search_history;
create policy "update own search history" on public.search_history
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "delete own search history" on public.search_history;
create policy "delete own search history" on public.search_history
  for delete using (user_id = auth.uid());

-- Search is case-insensitive substring matching on captions/usernames. These
-- trigram indexes keep `ilike '%term%'` from degrading into a full scan as the
-- video and profile tables grow.
create extension if not exists pg_trgm;

create index if not exists videos_caption_trgm_idx
  on public.videos using gin (caption gin_trgm_ops);

create index if not exists videos_username_trgm_idx
  on public.videos using gin (username gin_trgm_ops);

create index if not exists profiles_username_trgm_idx
  on public.profiles using gin (username gin_trgm_ops);

create index if not exists profiles_display_name_trgm_idx
  on public.profiles using gin (display_name gin_trgm_ops);

notify pgrst, 'reload schema';
