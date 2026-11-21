-- ===========================================================================
-- Coolerup · TikTok 24/7 sync — ONE-SHOT SETUP
--
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- It is idempotent: running it twice is harmless.
--
-- It does three things:
--   1. Verifies the prerequisites it depends on (full_videos, profiles, has_role)
--   2. Creates every TikTok table / index / policy / function
--   3. Prints a report so you can see exactly what state you are in
--
-- Nothing here pulls videos. Pulling happens when the app calls
-- /api/tiktok/sync (cron) or you press "Run sync now" in /admin → TikTok.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- STEP 1 — Prerequisites
-- ---------------------------------------------------------------------------
-- `full_videos` must already exist (migration 20261119000000_full_videos.sql).
-- If this block raises, stop: the base schema is missing and nothing below
-- will work.

do $$
begin
  if to_regclass('public.full_videos') is null then
    raise exception
      'public.full_videos is missing. Run 20261119000000_full_videos.sql first.';
  end if;
end
$$;

-- These two are created outside this repo (by Lovable). We do not fail if they
-- are absent — the policies below are wrapped so a missing has_role() cannot
-- abort the setup.
select
  to_regclass('public.full_videos')  as full_videos,
  to_regclass('public.profiles')     as profiles,
  to_regclass('public.user_roles')   as user_roles,
  exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'has_role'
  ) as has_role_function;


-- ---------------------------------------------------------------------------
-- STEP 2 — full_videos: TikTok provenance + dedupe
-- ---------------------------------------------------------------------------

alter table public.full_videos
  add column if not exists is_tiktok boolean not null default false,
  add column if not exists tiktok_id text,
  add column if not exists tiktok_author text;

create unique index if not exists full_videos_tiktok_id_key
  on public.full_videos (tiktok_id)
  where tiktok_id is not null;

create index if not exists full_videos_is_tiktok_idx
  on public.full_videos (is_tiktok, created_at desc);


-- ---------------------------------------------------------------------------
-- STEP 3 — Sources
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_sources (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('creator', 'video', 'hashtag')),
  value text not null check (char_length(value) between 1 and 200),
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


-- ---------------------------------------------------------------------------
-- STEP 4 — Settings (single row, id = 1)
-- ---------------------------------------------------------------------------

create table if not exists public.tiktok_sync_settings (
  id smallint primary key default 1 check (id = 1),
  enabled boolean not null default true,
  interval_minutes integer not null default 15 check (interval_minutes between 5 and 1440),
  max_per_source integer not null default 5 check (max_per_source between 1 and 50),
  owner_user_id uuid references auth.users (id) on delete set null,
  auto_publish boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.tiktok_sync_settings (id) values (1)
on conflict (id) do nothing;


-- ---------------------------------------------------------------------------
-- STEP 5 — Run log
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


-- ---------------------------------------------------------------------------
-- STEP 6 — RLS + admin-read policies
-- ---------------------------------------------------------------------------
-- Wrapped in exception handlers: if public.has_role() does not exist, we skip
-- the policy instead of aborting the whole script. The service role (used by
-- the sync job) bypasses RLS either way.

alter table public.tiktok_sources       enable row level security;
alter table public.tiktok_sync_settings enable row level security;
alter table public.tiktok_sync_runs     enable row level security;

do $$
begin
  drop policy if exists "admins read tiktok sources" on public.tiktok_sources;
  create policy "admins read tiktok sources"
    on public.tiktok_sources for select
    to authenticated
    using (public.has_role(auth.uid(), 'admin'));
exception when others then
  raise notice 'skipped sources policy: %', sqlerrm;
end
$$;

do $$
begin
  drop policy if exists "admins read tiktok settings" on public.tiktok_sync_settings;
  create policy "admins read tiktok settings"
    on public.tiktok_sync_settings for select
    to authenticated
    using (public.has_role(auth.uid(), 'admin'));
exception when others then
  raise notice 'skipped settings policy: %', sqlerrm;
end
$$;

do $$
begin
  drop policy if exists "admins read tiktok runs" on public.tiktok_sync_runs;
  create policy "admins read tiktok runs"
    on public.tiktok_sync_runs for select
    to authenticated
    using (public.has_role(auth.uid(), 'admin'));
exception when others then
  raise notice 'skipped runs policy: %', sqlerrm;
end
$$;


-- ---------------------------------------------------------------------------
-- STEP 7 — Grants
-- ---------------------------------------------------------------------------

grant select on public.tiktok_sources       to authenticated;
grant select on public.tiktok_sync_settings to authenticated;
grant select on public.tiktok_sync_runs     to authenticated;
grant all    on public.tiktok_sources       to service_role;
grant all    on public.tiktok_sync_settings to service_role;
grant all    on public.tiktok_sync_runs     to service_role;


-- ---------------------------------------------------------------------------
-- STEP 8 — Run-slot claim function (advisory lock + interval throttle)
-- ---------------------------------------------------------------------------

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


-- ---------------------------------------------------------------------------
-- STEP 9 — Ask PostgREST to pick up the new tables right away
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';


-- ===========================================================================
-- STEP 10 — REPORT: what state are you actually in?
-- ===========================================================================

select 'tables' as check, 'tiktok_sources' as object,
       case when to_regclass('public.tiktok_sources') is not null
            then 'ok' else 'MISSING' end as result
union all
select 'tables', 'tiktok_sync_settings',
       case when to_regclass('public.tiktok_sync_settings') is not null
            then 'ok' else 'MISSING' end
union all
select 'tables', 'tiktok_sync_runs',
       case when to_regclass('public.tiktok_sync_runs') is not null
            then 'ok' else 'MISSING' end
union all
select 'column', 'full_videos.is_tiktok',
       case when exists (
              select 1 from information_schema.columns
              where table_schema = 'public'
                and table_name = 'full_videos'
                and column_name = 'is_tiktok')
            then 'ok' else 'MISSING' end
union all
select 'function', 'tiktok_claim_run',
       case when exists (
              select 1 from pg_proc p
              join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'tiktok_claim_run')
            then 'ok' else 'MISSING' end
union all
select 'settings row', 'id = 1',
       case when exists (select 1 from public.tiktok_sync_settings where id = 1)
            then 'ok' else 'MISSING' end
union all
select 'sources added', 'enabled sources',
       (select count(*)::text from public.tiktok_sources where enabled)
union all
select 'tiktok videos', 'rows in full_videos',
       (select count(*)::text from public.full_videos where is_tiktok)
union all
select 'sync runs', 'rows in tiktok_sync_runs',
       (select count(*)::text from public.tiktok_sync_runs);

-- Who will own the pulled videos (owner_user_id, else oldest admin/owner).
select
  s.owner_user_id,
  coalesce(u.email, '(not set — falls back to oldest admin)') as configured_owner_email,
  (select ur.user_id from public.user_roles ur
    where ur.role in ('admin', 'owner')
    order by ur.created_at asc limit 1) as fallback_owner_user_id
from public.tiktok_sync_settings s
left join auth.users u on u.id = s.owner_user_id
where s.id = 1;


-- ===========================================================================
-- STEP 11 — OPTIONAL: add your first source, right here in SQL.
--
-- Uncomment ONE of these, change the value, and run it. Then press
-- "Run sync now" in /admin → TikTok (or wait for cron).
-- ===========================================================================

-- A creator's whole profile:
-- insert into public.tiktok_sources (kind, value, label)
-- values ('creator', 'charlidamelio', '@charlidamelio')
-- on conflict (kind, value) do nothing;

-- A single video (always works, no TikTok API token needed):
-- insert into public.tiktok_sources (kind, value, label)
-- values ('video', '7234567890123456789', 'test clip')
-- on conflict (kind, value) do nothing;

-- A hashtag (needs TikTok Research API — will report an explicit reason):
-- insert into public.tiktok_sources (kind, value, label)
-- values ('hashtag', 'fyp', '#fyp')
-- on conflict (kind, value) do nothing;
