-- GTA 6 update: the "GTA 6 - Beat" library sound by @coolerup
--
-- A library sound (not a user video's audio), so `original_video_id` stays NULL.
-- The audio file lives in public/sounds/gta6/gta6-beat.mp3 and is synthesised
-- from scratch by scripts/generate-gta6-sound.py — no commercial recordings, so
-- "Use this sound" stays copyright-safe.
--
-- Idempotent: re-running the migration won't duplicate the row.

insert into public.sounds (original_video_id, audio_url, title, creator_username, uses_count)
select null, '/sounds/gta6/gta6-beat.mp3', 'GTA 6 - Beat', 'coolerup', 0
where not exists (
  select 1
  from public.sounds s
  where s.title = 'GTA 6 - Beat'
    and s.creator_username = 'coolerup'
);

-- The picker looks this up by creator + title prefix.
create index if not exists sounds_gta6_idx
  on public.sounds (creator_username, title)
  where creator_username = 'coolerup';
