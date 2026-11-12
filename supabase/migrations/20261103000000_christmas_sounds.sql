-- Christmas update: 10 "Christmas - ..." sounds by @coolerup
--
-- These are library sounds, not the audio track of a user video, so
-- `original_video_id` has to become nullable. (Postgres allows many NULLs in a
-- unique column, so sounds_original_video_id_key keeps working for real
-- original sounds.)
--
-- The audio files live in public/sounds/christmas/*.mp3 and are public-domain
-- carols synthesised by scripts/generate-christmas-sounds.py — no commercial
-- recordings, so "Use this sound" stays copyright-safe.
--
-- Idempotent: re-running the migration won't duplicate rows.

alter table public.sounds alter column original_video_id drop not null;

insert into public.sounds (original_video_id, audio_url, title, creator_username, uses_count)
select null, v.audio_url, v.title, 'coolerup', 0
from (
  values
    ('Christmas - Jingle Bells', '/sounds/christmas/jingle-bells.mp3'),
    ('Christmas - We Wish You a Merry Christmas', '/sounds/christmas/we-wish-you-a-merry-christmas.mp3'),
    ('Christmas - Deck the Halls', '/sounds/christmas/deck-the-halls.mp3'),
    ('Christmas - Silent Night', '/sounds/christmas/silent-night.mp3'),
    ('Christmas - O Christmas Tree', '/sounds/christmas/o-christmas-tree.mp3'),
    ('Christmas - Joy to the World', '/sounds/christmas/joy-to-the-world.mp3'),
    ('Christmas - The First Noel', '/sounds/christmas/the-first-noel.mp3'),
    ('Christmas - Away in a Manger', '/sounds/christmas/away-in-a-manger.mp3'),
    ('Christmas - Hark! The Herald Angels Sing', '/sounds/christmas/hark-the-herald-angels-sing.mp3'),
    ('Christmas - O Come, All Ye Faithful', '/sounds/christmas/o-come-all-ye-faithful.mp3')
) as v(title, audio_url)
where not exists (
  select 1
  from public.sounds s
  where s.title = v.title
    and s.creator_username = 'coolerup'
);

-- The picker looks these up by creator + title prefix.
create index if not exists sounds_christmas_idx
  on public.sounds (creator_username, title)
  where creator_username = 'coolerup';
