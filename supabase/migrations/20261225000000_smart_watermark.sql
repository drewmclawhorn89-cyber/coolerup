-- Smart Watermark tracking: remembers whether an uploaded video already
-- carried an external social media watermark (TikTok, Instagram, YouTube, etc.)
-- so downloads keep the exact uploaded video instead of stacking a second mark.

alter table public.videos
  add column if not exists has_external_watermark boolean not null default false;

alter table public.full_videos
  add column if not exists has_external_watermark boolean not null default false;

-- Backfill any synced TikTok rows that were already ingested.
update public.videos
set has_external_watermark = true
where coalesce(is_tiktok, false) = true
  and has_external_watermark = false;

update public.full_videos
set has_external_watermark = true
where coalesce(is_tiktok, false) = true
  and has_external_watermark = false;
