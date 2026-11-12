-- Remove the GTA 6 update entirely.
--
-- The update shipped as three migrations (badges, sounds, challenge). Those are
-- deleted, and this migration tears the objects back out of databases that
-- already ran them, so a live project ends up in the same state as a fresh one.

-- Challenge progress / claim bookkeeping.
drop function if exists public.my_gta6_challenge_reward();
drop function if exists public.claim_gta6_challenge();
drop function if exists public.gta6_challenge_progress();
drop function if exists public.gta6_video_count(uuid, text);
drop function if exists public.gta6_window();
drop table if exists public.gta6_challenge_claims;

-- Permanent OG badge.
drop function if exists public.award_gta6_badge();
drop table if exists public.gta6_badges;

-- Sound library index for the "GTA 6 - ..." tracks.
drop index if exists public.sounds_gta6_idx;

-- The event sounds themselves. Only rows the event created are removed.
delete from public.sounds
where creator_username = 'coolerup'
  and title like 'GTA 6 - %';
