-- =====================================================================
-- Coolerup · TikTok ingest — ONE PASTE
--
-- Supabase -> SQL Editor -> New query -> paste all of this -> Run.
-- Safe to run more than once.
--
-- Creates the TikTok columns and tables, seeds a source, pins
-- @drewmclawhorn3 as the account that owns every pulled video, and
-- rewrites any rows that already exist.
-- =====================================================================

-- 1. Provenance columns on the short-form feed table ------------------
alter table public.videos
  add column if not exists is_tiktok     boolean not null default false,
  add column if not exists tiktok_id     text,
  add column if not exists tiktok_author text;

create unique index if not exists videos_tiktok_id_key
  on public.videos (tiktok_id) where tiktok_id is not null;

create index if not exists videos_is_tiktok_idx
  on public.videos (is_tiktok, created_at desc);

-- 2. Sources ----------------------------------------------------------
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

-- 3. Settings (single row) --------------------------------------------
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

-- 4. Run log ----------------------------------------------------------
create table if not exists public.tiktok_sync_runs (
  id uuid primary key default gen_random_uuid(),
  trigger text not null default 'cron' check (trigger in ('cron', 'manual')),
  status text not null default 'running'
    check (status in ('running', 'ok', 'partial', 'error', 'skipped')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sources_checked integer not null default 0,
  videos_added integer not null default 0,
  videos_skipped integer not null default 0,
  message text
);

create index if not exists tiktok_sync_runs_started_idx
  on public.tiktok_sync_runs (started_at desc);

-- 5. Lock the tables down. The app only touches these with the service
--    role, which bypasses RLS, so no policies are needed.
alter table public.tiktok_sources       enable row level security;
alter table public.tiktok_sync_settings enable row level security;
alter table public.tiktok_sync_runs     enable row level security;

-- 6. Run-slot claim: advisory lock + interval throttle ----------------
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
  if v_last is not null
     and v_last > now() - make_interval(mins => p_interval_minutes) then
    return null;
  end if;

  insert into public.tiktok_sync_runs (trigger)
  values (p_trigger)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.tiktok_claim_run(text, integer)
  from public, anon, authenticated;
grant execute on function public.tiktok_claim_run(text, integer) to service_role;

-- 7. Seed a source so there is something to pull ----------------------
insert into public.tiktok_sources (kind, value, label)
values ('creator', 'charlidamelio', '@charlidamelio')
on conflict (kind, value) do update set enabled = true;

-- 8. Attribute everything to @drewmclawhorn3 -------------------------
do $$
declare
  v_handle  text := 'drewmclawhorn3';
  v_user_id uuid;
  v_rows    integer;
begin
  select id into v_user_id
  from public.profiles
  where lower(handle) = lower(v_handle)
  limit 1;

  if v_user_id is null then
    raise exception
      'No profile has handle "%". Run: select id, handle from public.profiles; and fix the spelling.',
      v_handle;
  end if;

  update public.tiktok_sync_settings
     set owner_user_id = v_user_id, updated_at = now()
   where id = 1;

  if not found then
    insert into public.tiktok_sync_settings (id, owner_user_id)
    values (1, v_user_id)
    on conflict (id) do update set owner_user_id = excluded.owner_user_id;
  end if;

  update public.videos
     set user_id       = v_user_id,
         username      = v_handle,
         tiktok_author = coalesce(tiktok_author, username)
   where is_tiktok = true;

  get diagnostics v_rows = row_count;
  raise notice 'Attributed % existing TikTok row(s) to @%.', v_rows, v_handle;
end
$$;

-- 9. Refresh PostgREST's schema cache --------------------------------
notify pgrst, 'reload schema';

-- 10. Verify ---------------------------------------------------------
select
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'videos'
      and column_name in ('is_tiktok', 'tiktok_id', 'tiktok_author')) as columns_of_3,
  (select count(*) from public.tiktok_sources where enabled)          as enabled_sources,
  (select count(*) from public.videos where is_tiktok)                as tiktok_videos,
  (select count(*) from public.videos where is_tiktok and username = 'drewmclawhorn3')
                                                                      as attributed_to_me,
  (select p.handle from public.tiktok_sync_settings s
     join public.profiles p on p.id = s.owner_user_id
    where s.id = 1)                                                   as owner_handle;
