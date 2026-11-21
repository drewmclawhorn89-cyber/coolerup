-- 24/7 TikTok ingestion.
--
-- Coolerup never rehosts someone else's TikTok file. Each ingested video is a
-- row in `full_videos` that points at the canonical TikTok share URL and the
-- cover image, and playback happens through TikTok's own embed player (the
-- same rule the YouTube additions follow). That keeps the storage bucket for
-- things the app actually owns and keeps us on the right side of TikTok's
-- terms of service.
--
-- Three small tables drive the background job:
--   tiktok_sources        what to watch (a creator, a single video, a hashtag)
--   tiktok_sync_settings  one row: on/off, cadence, per-run cap, owner account
--   tiktok_sync_runs      an audit log so the admin panel can show what happened
--
-- Everything is written by the service role from the cron route, so RLS is
-- admin-only for reads and there are no client write policies at all.

-- ---------------------------------------------------------------------------
-- full_videos: TikTok provenance + dedupe
-- ---------------------------------------------------------------------------

alter table public.full_videos
  add column if not exists is_tiktok boolean not null default false,
  add column if not exists tiktok_id text,
  add column if not exists tiktok_author text;

-- One row per TikTok video, no matter how many sources surface it. The partial
-- index lets the sync job use a plain `on conflict` upsert and makes the
-- "already have this one" check an index lookup instead of a table scan.
create unique index if not exists full_videos_tiktok_id_key
  on public.full_videos (tiktok_id)
  where tiktok_id is not null;

create index if not exists full_videos_is_tiktok_idx
  on public.full_videos (is_tiktok, created_at desc);

-- ---------------------------------------------------------------------------
-- Sources
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_sources (
  id uuid primary key default gen_random_uuid(),
  -- 'creator'  -> https://www.tiktok.com/@handle
  -- 'video'    -> https://www.tiktok.com/@handle/video/<id>
  -- 'hashtag'  -> https://www.tiktok.com/tag/<tag>
  kind text not null check (kind in ('creator', 'video', 'hashtag')),
  -- Normalised key: the handle without '@', the numeric video id, or the tag.
  value text not null check (char_length(value) between 1 and 200),
  -- What the admin typed, shown back in the panel.
  label text not null default '',
  enabled boolean not null default true,
  last_synced_at timestamptz,
  last_error text,
  added_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, value)
);

create index if not exists tiktok_sources_enabled_idx
  on public.tiktok_sources (enabled, last_synced_at);

alter table public.tiktok_sources enable row level security;

drop policy if exists "admins read tiktok sources" on public.tiktok_sources;
create policy "admins read tiktok sources"
  on public.tiktok_sources for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Settings (single row, id = 1)
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_sync_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  -- The cron route fires every 15 minutes; this is the minimum gap between
  -- runs it will honour, so a stuck scheduler cannot hammer TikTok.
  interval_minutes integer not null default 15 check (interval_minutes between 5 and 1440),
  -- Per source, per run. Keeps one prolific creator from flooding the feed.
  max_per_source integer not null default 5 check (max_per_source between 1 and 50),
  -- Ingested rows need an owning account for the user_id foreign key. Defaults
  -- to the first admin when null.
  owner_user_id uuid references auth.users (id) on delete set null,
  -- When false, new rows are inserted hidden so an admin can review them first.
  auto_publish boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.tiktok_sync_settings (id) values (1)
on conflict (id) do nothing;

alter table public.tiktok_sync_settings enable row level security;

drop policy if exists "admins read tiktok settings" on public.tiktok_sync_settings;
create policy "admins read tiktok settings"
  on public.tiktok_sync_settings for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Run log
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_checked integer not null default 0,
  videos_added integer not null default 0,
  videos_skipped integer not null default 0,
  message text
);

create index if not exists tiktok_sync_runs_started_idx
  on public.tiktok_sync_runs (started_at desc);

alter table public.tiktok_sync_runs enable row level security;

drop policy if exists "admins read tiktok runs" on public.tiktok_sync_runs;
create policy "admins read tiktok runs"
  on public.tiktok_sync_runs for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

grant select on public.tiktok_sources to authenticated;
grant select on public.tiktok_sync_settings to authenticated;
grant select on public.tiktok_sync_runs to authenticated;
grant all on public.tiktok_sources to service_role;
grant all on public.tiktok_sync_settings to service_role;
grant all on public.tiktok_sync_runs to service_role;

-- ---------------------------------------------------------------------------
-- Cron helpers
-- ---------------------------------------------------------------------------

-- Claim a run slot atomically. Returns the new run id, or null when the last
-- run was too recent (or another run is still in flight). The advisory lock
-- makes two overlapping cron invocations safe: the second one gets null
-- instead of racing the first.
create or replace function public.tiktok_claim_run(
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
  if not pg_try_advisory_xact_lock(918273645) then
    return null;
  end if;

  select count(*) into v_running
    from public.tiktok_sync_runs
   where status = 'running'
     and started_at > now() - interval '10 minutes';
  if v_running > 0 then
    return null;
  end if;

  select max(started_at) into v_last from public.tiktok_sync_runs;
  if v_last is not null and v_last > now() - make_interval(mins => p_interval_minutes) then
    return null;
  end if;

  insert into public.tiktok_sync_runs (trigger)
  values (p_trigger)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.tiktok_claim_run(text, integer) from public, anon, authenticated;
grant execute on function public.tiktok_claim_run(text, integer) to service_role;
