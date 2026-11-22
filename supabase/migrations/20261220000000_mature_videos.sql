-- ============================================================================
-- Coolerup · 18+ Mature Videos
-- ============================================================================
-- Lets a creator mark a single video (short form or long form) as 18+.
-- Everything here is additive: both tables gain one boolean column that
-- defaults to false, so every existing row and every new upload behaves
-- exactly as it does today until the creator deliberately opts in.
--
-- The flag is metadata only. Whether a viewer may actually watch the video is
-- decided from their Coolerup account birthday (profiles.birthday) in the app,
-- and the feed hides mature rows entirely when the viewer turns off
-- "Show 18+ Videos" in Settings > Privacy. No camera, no face scan.
-- ============================================================================

alter table public.videos
  add column if not exists is_mature boolean not null default false;

alter table public.full_videos
  add column if not exists is_mature boolean not null default false;

-- The feed filters mature rows in and out, so keep that lookup cheap.
create index if not exists videos_is_mature_idx
  on public.videos (is_mature) where is_mature = true;
create index if not exists full_videos_is_mature_idx
  on public.full_videos (is_mature) where is_mature = true;

comment on column public.videos.is_mature is
  'Creator-marked 18+ video. Viewers must be 18+ (profiles.birthday) to watch.';
comment on column public.full_videos.is_mature is
  'Creator-marked 18+ long-form video. Viewers must be 18+ (profiles.birthday) to watch.';
