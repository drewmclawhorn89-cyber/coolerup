-- ============================================================================
-- Coolerup · Linked TikTok accounts (Login Kit + Content Posting API)
-- ============================================================================
-- One row per Coolerup user who has authorised their OWN TikTok account.
--
-- SECURITY: this table holds OAuth access and refresh tokens. It therefore has
-- RLS enabled and NO select policy for `authenticated` or `anon` — the browser
-- can never read a token. The owner reads the non-secret fields through
-- `public.my_tiktok_account()`, which is SECURITY DEFINER and only ever returns
-- the caller's own row with the token columns dropped. Writes happen exclusively
-- from server routes using the service-role key.
--
-- Scope of the feature, deliberately: a user can only ever act on the account
-- they personally authorised. There is no path here that reads another person's
-- TikTok videos, and `video.list` is called with the caller's own token only.
-- ============================================================================

create table if not exists public.tiktok_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  open_id text not null,
  union_id text,
  username text not null,
  display_name text,
  avatar_url text,
  follower_count bigint not null default 0,
  following_count bigint not null default 0,
  likes_count bigint not null default 0,
  video_count bigint not null default 0,
  scope text,
  access_token text not null,
  refresh_token text not null,
  access_expires_at timestamptz not null,
  refresh_expires_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One TikTok account cannot be claimed by two Coolerup users.
create unique index if not exists tiktok_accounts_open_id_key
  on public.tiktok_accounts (open_id);

alter table public.tiktok_accounts enable row level security;

-- No policies are created on purpose. RLS with zero policies denies every
-- client read and write; the service role bypasses RLS for the server routes.
revoke all on public.tiktok_accounts from anon, authenticated;

-- ---------------------------------------------------------------------------
-- What the owner is allowed to see: everything except the tokens.
-- ---------------------------------------------------------------------------
create or replace function public.my_tiktok_account()
returns table (
  open_id text,
  username text,
  display_name text,
  avatar_url text,
  follower_count bigint,
  following_count bigint,
  likes_count bigint,
  video_count bigint,
  scope text,
  connected_at timestamptz,
  last_synced_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select a.open_id,
         a.username,
         a.display_name,
         a.avatar_url,
         a.follower_count,
         a.following_count,
         a.likes_count,
         a.video_count,
         a.scope,
         a.created_at,
         a.last_synced_at
    from public.tiktok_accounts a
   where a.user_id = auth.uid()
$$;

revoke all on function public.my_tiktok_account() from public, anon;
grant execute on function public.my_tiktok_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Every attempt to publish to TikTok, so a failed auto-post is visible instead
-- of silently swallowed. Owner-readable; written by the server.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_publishes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id uuid,
  tiktok_publish_id text,
  status text not null default 'pending',
  mode text not null default 'direct',
  caption text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tiktok_publishes_user_idx
  on public.tiktok_publishes (user_id, created_at desc);

alter table public.tiktok_publishes enable row level security;

drop policy if exists "owners read own tiktok publishes" on public.tiktok_publishes;
create policy "owners read own tiktok publishes"
  on public.tiktok_publishes
  for select
  to authenticated
  using (user_id = auth.uid());

revoke insert, update, delete on public.tiktok_publishes from anon, authenticated;
grant select on public.tiktok_publishes to authenticated;

-- ---------------------------------------------------------------------------
-- Which of the user's own TikTok videos have already been imported, so the
-- picker cannot create duplicates and re-importing is a no-op.
-- ---------------------------------------------------------------------------
create table if not exists public.tiktok_imports (
  user_id uuid not null references auth.users (id) on delete cascade,
  tiktok_id text not null,
  video_id uuid,
  imported_at timestamptz not null default now(),
  primary key (user_id, tiktok_id)
);

alter table public.tiktok_imports enable row level security;

drop policy if exists "owners read own tiktok imports" on public.tiktok_imports;
create policy "owners read own tiktok imports"
  on public.tiktok_imports
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "owners insert own tiktok imports" on public.tiktok_imports;
create policy "owners insert own tiktok imports"
  on public.tiktok_imports
  for insert
  to authenticated
  with check (user_id = auth.uid());

grant select, insert on public.tiktok_imports to authenticated;

comment on table public.tiktok_accounts is
  'OAuth tokens for a user''s own linked TikTok account. No client select policy: tokens are server-only.';
comment on function public.my_tiktok_account() is
  'Non-secret view of the caller''s linked TikTok account. Never returns tokens.';
