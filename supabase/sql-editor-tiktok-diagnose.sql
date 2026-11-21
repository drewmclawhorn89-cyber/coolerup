-- =====================================================================
-- Coolerup · TikTok ingest DIAGNOSTIC
--
-- Read-only. Changes nothing. Paste the whole file into the Supabase
-- SQL Editor and press Run. Read the "verdict" rows at the bottom.
--
-- It answers, in order:
--   1. Do the TikTok columns exist on public.videos?
--   2. Are there any TikTok rows in the feed at all?
--   3. What sources are configured, and what did each one last say?
--   4. What did the last sync runs do?
--   5. What is the verdict?
-- =====================================================================

-- ---------------------------------------------------------------- 1
-- Do the columns the ingest code writes actually exist?
select
  '1. columns'                        as section,
  c.column_name,
  case when c.column_name is null then 'MISSING' else 'ok' end as state
from (values ('is_tiktok'), ('tiktok_id'), ('tiktok_author')) as want(column_name)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name   = 'videos'
 and c.column_name  = want.column_name
order by c.column_name nulls last;

-- ---------------------------------------------------------------- 2
-- Is anything actually in the feed?
select
  '2. rows'                                        as section,
  count(*) filter (where is_tiktok)                as tiktok_rows,
  count(*) filter (where is_tiktok and not hidden) as visible_in_feed,
  count(*) filter (where is_tiktok and hidden)     as hidden_by_moderation,
  count(*)                                         as total_feed_rows
from public.videos;

-- ---------------------------------------------------------------- 3
-- What sources are configured, and what happened to each?
select
  '3. sources'      as section,
  kind,
  value,
  enabled,
  coalesce(nullif(last_error, ''), '-') as last_error,
  last_synced_at
from public.tiktok_sources
order by enabled desc, last_synced_at nulls first;

-- ---------------------------------------------------------------- 4
-- What did the sync runs say?
select
  '4. runs'      as section,
  trigger,
  status,
  sources_checked,
  videos_added,
  videos_skipped,
  left(coalesce(message, ''), 300) as message,
  started_at
from public.tiktok_sync_runs
order by started_at desc
limit 10;

-- ---------------------------------------------------------------- 5
-- Settings
select
  '5. settings' as section,
  enabled,
  interval_minutes,
  max_per_source,
  auto_publish,
  owner_user_id
from public.tiktok_sync_settings
where id = 1;

-- ---------------------------------------------------------------- 6
-- VERDICT: one row per problem found. If this returns nothing, the
-- pipeline is healthy and the clips are simply shuffled into the feed.
with cols as (
  select count(*) as n
  from information_schema.columns
  where table_schema = 'public' and table_name = 'videos'
    and column_name in ('is_tiktok', 'tiktok_id', 'tiktok_author')
),
rows_ as (
  select count(*) filter (where is_tiktok) as n from public.videos
),
src as (
  select
    count(*) filter (where enabled)                            as enabled,
    count(*) filter (where enabled and kind = 'creator')       as creators,
    count(*) filter (where enabled and kind = 'video')         as videos,
    count(*) filter (where enabled and last_error is not null) as failing
  from public.tiktok_sources
)
select 'VERDICT' as section, problem, fix from (
  select 1 as ord, 'The TikTok columns are missing from public.videos — every insert is failing silently.' as problem,
         'Run supabase/sql-editor-tiktok-setup.sql (or let Lovable apply the 20261215 migration).' as fix
  where (select n from cols) < 3
  union all
  select 2, 'No sources are configured, so there is nothing to pull.',
         'Add at least one source row (see the INSERT at the bottom of this file).'
  where (select enabled from src) = 0
  union all
  select 3, 'All your sources are creator handles. TikTok serves a login wall to server-side requests, so a creator handle returns zero videos unless TIKTOK_ACCESS_TOKEN is set.',
         'Either add single video links (kind = ''video'') which work without a token, or set TIKTOK_ACCESS_TOKEN for creator discovery.'
  where (select creators from src) > 0 and (select videos from src) = 0
  union all
  select 4, 'Every source is reporting an error on its last run.',
         'Read the last_error column in section 3 above — it names the exact reason.'
  where (select failing from src) > 0 and (select n from rows_) = 0
  union all
  select 5, 'No sync has ever completed.',
         'Open the app once (the heartbeat fires) or call runTikTokSyncNow from the admin panel.'
  where not exists (select 1 from public.tiktok_sync_runs where status in ('ok', 'partial'))
) t
order by ord;

-- =====================================================================
-- FIX · add sources that actually work without a token
--
-- Single video links are the only discovery path that does not need a
-- TikTok developer token. Paste real TikTok URLs, one row each.
-- The `value` column takes a full https://www.tiktok.com/@user/video/<id>
-- URL, a bare video id, or a vm.tiktok.com short link.
--
-- Uncomment and edit:
-- =====================================================================
-- insert into public.tiktok_sources (kind, value, label)
-- values
--   ('video', 'https://www.tiktok.com/@REPLACE_ME/video/0000000000000000000', 'my first clip'),
--   ('video', 'https://vm.tiktok.com/REPLACE_ME/',                          'short link clip')
-- on conflict (kind, value) do update set enabled = true;
--
-- select * from public.tiktok_sources order by created_at desc;
