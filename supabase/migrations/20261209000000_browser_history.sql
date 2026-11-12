-- 20261209000000_browser_history.sql
--
-- Storage for the in-app Browser.
--
--   * `browser_history`   — the last N pages/searches a person visited, shown
--                           in the History panel and capped in the UI at 20.
--   * `browser_bookmarks` — sites a person starred with the ⭐ Save button,
--                           rendered like "Your Sounds" in the Music tab.
--
-- Both tables are strictly private: a row belongs to exactly one person and
-- nobody else may read, write, update or delete it. The policies below enforce
-- that with `auth.uid()`, and the grants keep `anon` out entirely so a logged
-- out visitor cannot even probe the tables.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. browser_history
-- ---------------------------------------------------------------------------
create table if not exists public.browser_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query text,
  url text,
  created_at timestamptz not null default now()
);

-- Newest-first lookups per person are the only query we run.
create index if not exists browser_history_user_created_idx
  on public.browser_history (user_id, created_at desc);

alter table public.browser_history enable row level security;

drop policy if exists "browser_history_select_own" on public.browser_history;
create policy "browser_history_select_own"
  on public.browser_history for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "browser_history_insert_own" on public.browser_history;
create policy "browser_history_insert_own"
  on public.browser_history for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "browser_history_delete_own" on public.browser_history;
create policy "browser_history_delete_own"
  on public.browser_history for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.browser_history from anon;
grant select, insert, delete on public.browser_history to authenticated;

-- ---------------------------------------------------------------------------
-- 2. browser_bookmarks
-- ---------------------------------------------------------------------------
create table if not exists public.browser_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  url text not null,
  title text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists browser_bookmarks_user_created_idx
  on public.browser_bookmarks (user_id, created_at desc);

-- A person cannot star the same URL twice.
create unique index if not exists browser_bookmarks_user_url_key
  on public.browser_bookmarks (user_id, url);

alter table public.browser_bookmarks enable row level security;

drop policy if exists "browser_bookmarks_select_own" on public.browser_bookmarks;
create policy "browser_bookmarks_select_own"
  on public.browser_bookmarks for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "browser_bookmarks_insert_own" on public.browser_bookmarks;
create policy "browser_bookmarks_insert_own"
  on public.browser_bookmarks for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "browser_bookmarks_delete_own" on public.browser_bookmarks;
create policy "browser_bookmarks_delete_own"
  on public.browser_bookmarks for delete
  to authenticated
  using (auth.uid() = user_id);

revoke all on public.browser_bookmarks from anon;
grant select, insert, delete on public.browser_bookmarks to authenticated;
