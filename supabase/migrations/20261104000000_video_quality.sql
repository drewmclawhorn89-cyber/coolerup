-- Video quality selector (TikTok-style).
--
-- Each video can expose up to four renditions. Until transcoding lands, the
-- upload path points every rendition at the original file, so these columns are
-- already populated and switching quality never fails. Playback always falls
-- back to `video_url` when a rendition is null, which covers rows uploaded
-- before this migration.

alter table public.videos
  add column if not exists video_1080_url text,
  add column if not exists video_720_url text,
  add column if not exists video_480_url text,
  add column if not exists video_360_url text,
  add column if not exists quality text not null default 'auto';

comment on column public.videos.video_1080_url is '1080p rendition URL (original upload until transcoding exists)';
comment on column public.videos.video_720_url is '720p rendition URL';
comment on column public.videos.video_480_url is '480p rendition URL';
comment on column public.videos.video_360_url is '360p rendition URL';
comment on column public.videos.quality is 'Default playback quality for this video: auto | 1080p | 720p | 480p | 360p | data';

-- Existing uploads are their own 1080p rendition. The other renditions stay
-- null and the player falls back to video_url for them.
update public.videos
   set video_1080_url = video_url
 where video_1080_url is null;

-- Guard the enum-ish column without blocking future values.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'videos_quality_check'
  ) then
    alter table public.videos
      add constraint videos_quality_check
      check (quality in ('auto', '1080p', '720p', '480p', '360p', 'data'));
  end if;
end $$;
