-- ===========================================================================
-- Coolerup · TikTok sync: who owns the pulled videos?
--
-- Paste this into Supabase → SQL Editor → New query, then Run.
-- Every statement is read-only except the last one, which is commented out.
-- ===========================================================================

-- 0. Preflight: has the TikTok migration been applied yet?
--    If this returns 0 rows, run supabase/migrations/20261214000000_tiktok_sync.sql
--    first — the tables below will not exist otherwise.
select
  to_regclass('public.tiktok_sync_settings') as settings_table,
  to_regclass('public.tiktok_sources')       as sources_table,
  to_regclass('public.tiktok_sync_runs')     as runs_table,
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'full_videos'
      and column_name = 'is_tiktok'
  ) as full_videos_has_is_tiktok;


-- 1. THE ANSWER: which account actually owns the TikTok videos right now.
--    One row per owning account (there should normally be exactly one).
select
  fv.user_id                                   as owner_user_id,
  coalesce(p.handle, p.username, '(no profile)') as owner_handle,
  count(*)                                     as tiktok_videos,
  min(fv.created_at)                           as first_pulled,
  max(fv.created_at)                           as last_pulled
from public.full_videos fv
left join public.profiles p on p.id = fv.user_id
where fv.is_tiktok = true
group by fv.user_id, p.handle, p.username
order by count(*) desc;


-- 2. What the sync job is configured to use, and what it falls back to.
--    effective_owner is the account the next run will write to:
--    owner_user_id if set, otherwise the oldest admin/owner in user_roles.
with fallback as (
  select ur.user_id
  from public.user_roles ur
  where ur.role in ('admin', 'owner')
  order by ur.created_at asc
  limit 1
)
select
  s.enabled,
  s.auto_publish,
  s.interval_minutes,
  s.max_per_source,
  s.owner_user_id,
  coalesce(p.handle, p.username, '(not set)')            as configured_owner,
  f.user_id                                              as fallback_owner_user_id,
  coalesce(pf.handle, pf.username, '(none)')             as fallback_owner_handle,
  coalesce(s.owner_user_id, f.user_id)                   as effective_owner_user_id
from public.tiktok_sync_settings s
left join fallback f on true
left join public.profiles p  on p.id  = s.owner_user_id
left join public.profiles pf on pf.id = f.user_id
where s.id = 1;


-- 3. Who is eligible to be the owner (the fallback candidates).
select
  ur.user_id,
  ur.role,
  ur.created_at,
  coalesce(p.handle, p.username, '(no profile)') as handle
from public.user_roles ur
left join public.profiles p on p.id = ur.user_id
where ur.role in ('admin', 'owner')
order by ur.created_at asc;


-- 4. Sanity check: how the videos are split, and what the grid shows.
--    `username` is the TikTok creator's handle; `user_id` is the owner account.
select
  fv.is_tiktok,
  count(*)                                        as videos,
  count(distinct fv.user_id)                      as distinct_owners,
  count(distinct fv.tiktok_author)                as distinct_tiktok_creators
from public.full_videos fv
group by fv.is_tiktok
order by fv.is_tiktok desc;


-- 5. Recent sync runs, so you can see the job is actually firing.
select
  started_at,
  finished_at,
  trigger,
  status,
  sources_checked,
  videos_added,
  videos_skipped,
  message
from public.tiktok_sync_runs
order by started_at desc
limit 20;


-- ===========================================================================
-- 6. OPTIONAL — pin the owner explicitly instead of relying on "oldest admin".
--
--    Replace 'your_handle' with the Coolerup handle (no @) that should own
--    every pulled TikTok video, uncomment, and run.
-- ===========================================================================

-- update public.tiktok_sync_settings s
-- set owner_user_id = (select id from public.profiles where handle = 'your_handle'),
--     updated_at    = now()
-- where s.id = 1;

-- If the settings row is somehow missing, create it first:
-- insert into public.tiktok_sync_settings (id) values (1) on conflict (id) do nothing;
