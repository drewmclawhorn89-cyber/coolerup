-- ===========================================================================
-- Coolerup Browser — Supabase SQL Editor script
-- Run this once in: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to run more than once (everything is IF NOT EXISTS / DROP POLICY IF EXISTS).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. browser_history — the last 20 searches / pages per person
-- ---------------------------------------------------------------------------
create table if not exists public.browser_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  query text,
  url text,
  created_at timestamptz not null default now()
);

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
-- 2. browser_bookmarks — sites saved with "⭐ Save to Coolerup"
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

-- ---------------------------------------------------------------------------
-- 3. Sanity check (optional) — should list both tables with rowsecurity = true
-- ---------------------------------------------------------------------------
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('browser_history', 'browser_bookmarks');
