-- 0022_remove_video_auto_ban.sql
--
-- POSTING A VIDEO MUST NEVER BAN OR HIDE ANYTHING.
--
-- Root cause
-- ----------
-- 0017_auto_moderation.sql was edited in place twice after it had already been
-- applied to the live database:
--
--   39067c7  original: 5 videos / 10 min -> 1 hour auto-ban, plus caption filter
--   b0ca378  removed the 5-videos rate limit (kept caption filter)
--   c6ca88b  "disabled" auto-bans and mutes
--
-- Editing a migration that has already run changes nothing in the database.
-- So the live DB is still executing the ORIGINAL moderate_new_video(), which
-- does this on every video insert:
--
--   if recent >= 5 then
--     perform public.apply_moderation(
--       new.user_id, handle, 'auto_ban_1h_spam',
--       format('Auto-banned: %s videos in 10 minutes', recent + 1),
--       1, false, 'ban', true, 'auto-moderation', null, null
--     );
--   end if;
--
-- i.e. the sixth upload in ten minutes bans the account for an hour.
--
-- Fix
-- ---
-- Drop the trigger and the function outright. Nothing runs on video insert.
-- Also unhide every video the caption filter hid, and lift every ban that
-- automation applied.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Remove the video-insert trigger and its function
-- ---------------------------------------------------------------------------

drop trigger if exists videos_moderate_insert on public.videos;
drop function if exists public.moderate_new_video();

-- Also make sure the comment trigger/function from the same era are gone.
drop trigger if exists comments_moderate_insert on public.comments;
drop function if exists public.moderate_new_comment();

-- ---------------------------------------------------------------------------
-- 2. Unhide videos hidden by the caption filter
-- ---------------------------------------------------------------------------

update public.videos
   set hidden = false,
       hidden_reason = null
 where hidden = true
   and hidden_reason = 'Banned words in caption';

-- ---------------------------------------------------------------------------
-- 3. Lift every ban automation applied (manual admin bans are kept)
-- ---------------------------------------------------------------------------

delete from public.banned_users where auto = true;

-- ---------------------------------------------------------------------------
-- 4. Refresh PostgREST's schema cache
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
