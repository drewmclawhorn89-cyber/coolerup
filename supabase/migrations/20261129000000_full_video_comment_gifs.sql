-- GIFs in full-length video comments.
--
-- The feed's short-clip comments have supported `gif_url` since
-- 0012_comment_gifs_and_replies.sql. Full-video comments (the thread under
-- /watch/$id) were text-only, so this brings them to parity: a comment can be
-- text, a GIF, or both.

alter table public.full_video_comments
  add column if not exists gif_url text
  check (gif_url is null or (char_length(gif_url) <= 500 and gif_url ~ '^https://'));

-- `body` is NOT NULL, so a GIF-only comment stores an empty string. Allow that
-- as long as there is a GIF to show.
alter table public.full_video_comments
  drop constraint if exists full_video_comments_body_check;
alter table public.full_video_comments
  add constraint full_video_comments_body_check
  check (
    char_length(body) <= 300
    and (char_length(body) >= 1 or gif_url is not null)
  );

notify pgrst, 'reload schema';
