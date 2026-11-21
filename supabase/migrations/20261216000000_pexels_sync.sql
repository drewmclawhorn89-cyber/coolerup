-- ============================================================================
-- Coolerup · 24/7 licensed video ingestion (Pexels)
-- ============================================================================
-- This is the sibling of the TikTok sync, with one deliberate difference:
-- Pexels videos are licensed for rehosting, so this job *does* download the
-- MP4 and serve it from our own bucket. Nothing here touches TikTok.
--
-- Provenance is first-class, not an afterthought:
--   source_provider  'pexels'
--   source_id        Pexels video id (dedupe key)
--   source_url       the Pexels page the video came from
--   source_author    the human who filmed it
--   rights_basis     why we are allowed to host it
--
-- Attribution is never rewritten: the feed card shows the owning Coolerup
-- account, and `source_author` keeps the real creator visible.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Provenance + dedupe on the feed table
-- ---------------------------------------------------------------------------

alter table public.videos
  add column if not exists source_provider text,
  add column if not exists source_id       text,
  add column if not exists source_url      text,
  add column if not exists source_author   text,
  add column if not exists rights_basis    text;

-- One row per upstream asset, no matter how many sources surface it.
create unique index if not exists videos_source_unique_idx
  on public.videos (source_provider, source_id)
  where source_provider is not null and source_id is not null;

create index if not exists videos_source_provider_idx
  on public.videos (source_provider, created_at desc);

-- ---------------------------------------------------------------------------
-- 2. What to pull
-- ---------------------------------------------------------------------------

create table if not exists public.pexels_sources (
  id uuid primary key default gen_random_uuid(),
  -- 'popular' -> Pexels /videos/popular
  -- 'search'  -> Pexels /videos/search?query=<value>
  kind text not null check (kind in ('popular', 'search')),
  -- Search term; ignored for 'popular' but kept non-empty for the constraint.
  value text not null default 'popular' check (char_length(value) between 1 and 200),
  label text not null default '',
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

create index if not exists pexels_sources_enabled_idx
  on public.pexels_sources (enabled, last_synced_at);

alter table public.pexels_sources enable row level security;

drop policy if exists "admins read pexels sources" on public.pexels_sources;
create policy "admins read pexels sources"
  on public.pexels_sources for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 3. Settings (single row)
-- ---------------------------------------------------------------------------

create table if not exists public.pexels_sync_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  interval_minutes integer not null default 15 check (interval_minutes between 5 and 1440),
  max_per_source integer not null default 4 check (max_per_source between 1 and 50),
  owner_user_id uuid references auth.users (id) on delete set null,
  auto_publish boolean not null default true,
  -- Hard ceiling per run so a bad query cannot drain the monthly quota.
  max_per_run integer not null default 8 check (max_per_run between 1 and 40),
  updated_at timestamptz not null default now()
);

insert into public.pexels_sync_settings (id) values (1)
on conflict (id) do nothing;

alter table public.pexels_sync_settings enable row level security;

drop policy if exists "admins read pexels settings" on public.pexels_sync_settings;
create policy "admins read pexels settings"
  on public.pexels_sync_settings for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 4. Run log
-- ---------------------------------------------------------------------------

create table if not exists public.pexels_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_checked integer not null default 0,
  videos_added integer not null default 0,
  videos_skipped integer not null default 0,
  api_calls integer not null default 0,
  message text
);

create index if not exists pexels_sync_runs_started_idx
  on public.pexels_sync_runs (started_at desc);

alter table public.pexels_sync_runs enable row level security;

drop policy if exists "admins read pexels runs" on public.pexels_sync_runs;
create policy "admins read pexels runs"
  on public.pexels_sync_runs for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.pexels_sources to authenticated;
grant select on public.pexels_sync_settings to authenticated;
grant select on public.pexels_sync_runs to authenticated;
grant all on public.pexels_sources to service_role;
grant all on public.pexels_sync_settings to service_role;
grant all on public.pexels_sync_runs to service_role;

-- ---------------------------------------------------------------------------
-- 5. Cron helper — same advisory-lock pattern as tiktok_claim_run
-- ---------------------------------------------------------------------------

create or replace function public.pexels_claim_run(
  p_trigger text,
  p_interval_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_last timestamptz;
  v_running integer;
begin
  -- Distinct lock key from the TikTok job so the two can run concurrently.
  if not pg_try_advisory_xact_lock(918273646) then
    return null;
  end if;

  select count(*) into v_running
    from public.pexels_sync_runs
   where status = 'running'
     and started_at > now() - interval '10 minutes';
  if v_running > 0 then
    return null;
  end if;

  select max(started_at) into v_last from public.pexels_sync_runs;
  if v_last is not null and v_last > now() - make_interval(mins => p_interval_minutes) then
    return null;
  end if;

  insert into public.pexels_sync_runs (trigger)
  values (p_trigger)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.pexels_claim_run(text, integer) from public, anon, authenticated;
grant execute on function public.pexels_claim_run(text, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Seed a couple of sources so the first run does something
-- ---------------------------------------------------------------------------

insert into public.pexels_sources (kind, value, label)
values
  ('popular', 'popular', 'Pexels · popular'),
  ('search',  'vertical', 'Pexels · vertical')
on conflict (kind, value) do nothing;
