-- Recordings made with a sound have the song mixed into the file. The app marks
-- those captions with [[baked]] so the feed doesn't overlay the sound twice.
-- Strip the marker when building a sound's human title, just like [[song:...]]
-- and [[full]].

create or replace function public.sound_title_for_video(_caption text, _username text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      btrim(regexp_replace(coalesce(_caption, ''), '\s*\[\[(song:[^\]]*|full|baked)\]\]\s*', '', 'gi')),
      ''
    ),
    'Original sound - @' || coalesce(_username, 'creator')
  );
$$;
