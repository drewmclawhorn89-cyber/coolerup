-- YouTube picks can be longer than the 60-minute cap we put on native uploads,
-- and their length comes from YouTube rather than from a file we measured.
-- Relax the check for rows flagged as YouTube so a 2-hour documentary can store
-- its real duration; native uploads keep the 60-minute ceiling, which is also
-- enforced in the app (MAX_FULL_VIDEO_SECONDS) before anything is inserted.

-- The flag column was added outside the migration history on some projects.
alter table public.full_videos
  add column if not exists is_youtube boolean not null default false;

alter table public.full_videos
  add column if not exists youtube_id text;

alter table public.full_videos
  drop constraint if exists full_videos_duration_check;

alter table public.full_videos
  add constraint full_videos_duration_check
  check (
    duration >= 0
    and (
      -- 12 hours: comfortably past the longest YouTube upload.
      (is_youtube and duration <= 43200)
      or (not is_youtube and duration <= 3600)
    )
  );

-- The grid backfills missing lengths by youtube_id, so that lookup wants an index.
create index if not exists full_videos_youtube_id_idx
  on public.full_videos (youtube_id)
  where youtube_id is not null;
