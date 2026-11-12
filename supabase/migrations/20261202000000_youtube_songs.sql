-- YouTube songs in the Music tab
--
-- A "song" in the Music tab is normally an original sound (the audio track of a
-- real Coolerup video). This migration lets a row also point at a YouTube video
-- instead: `source = 'youtube'`, `youtube_url` = the watch link, `cover_url` =
-- YouTube's thumbnail. Nothing is ever downloaded or re-hosted; playback streams
-- from YouTube's own embed player.
--
-- `audio_url` stays empty for YouTube rows so the feed's audio overlay (which
-- plays a borrowed sound under a video) simply skips them instead of trying to
-- load a watch page as a media file.

alter table public.sounds add column if not exists youtube_url text;
alter table public.sounds add column if not exists source text not null default 'own';
alter table public.sounds add column if not exists cover_url text;

-- YouTube songs have no source video, so the not-null constraint on
-- original_video_id has to go. The unique constraint stays for real sounds:
-- one original sound per video.
alter table public.sounds alter column original_video_id drop not null;

-- `audio_url` is required for own sounds but meaningless for YouTube songs.
alter table public.sounds alter column audio_url drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'sounds_source_check'
      and conrelid = 'public.sounds'::regclass
  ) then
    alter table public.sounds
      add constraint sounds_source_check check (source in ('own', 'youtube'));
  end if;
end $$;

-- Fast lookup of the YouTube shelf in the Music tab.
create index if not exists sounds_source_idx on public.sounds (source, created_at desc);
create index if not exists sounds_youtube_url_idx on public.sounds (youtube_url);

-- A YouTube link can only be added once, so two people pasting the same song
-- share one row (and one play count) instead of duplicating it.
create unique index if not exists sounds_youtube_url_key
  on public.sounds (youtube_url)
  where youtube_url is not null;

-- Bump a sound's play counter without needing a video. Used when a YouTube song
-- is opened in the Music player.
create or replace function public.increment_sound_play(_sound_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sounds set uses_count = uses_count + 1 where id = _sound_id;
$$;

grant execute on function public.increment_sound_play(uuid) to anon, authenticated;
