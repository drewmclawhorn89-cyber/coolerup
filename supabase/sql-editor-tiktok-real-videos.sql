-- ============================================================================
-- Coolerup · import REAL TikTok videos
-- ============================================================================
-- Paste this whole file into Supabase → SQL Editor → Run.
--
-- What it does:
--   1. Deletes the old "creator embed card" rows. Those were profile widgets,
--      not videos: they had no tiktok_id and could not play.
--   2. Inserts one real row per TikTok video link you list below, with a real
--      tiktok_id, so the feed plays the actual video in TikTok's own player.
--   3. Attributes every row to your Coolerup account (@drewmclawhorn3).
--   4. Prints a verification table.
--
-- You only ever edit the `links` array in step 2.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Remove non-video rows (creator widget cards from the old fallback)
-- ---------------------------------------------------------------------------
delete from public.videos
where is_tiktok = true
  and tiktok_id is null;

-- ---------------------------------------------------------------------------
-- 2. Paste your TikTok video links here, one per line, inside the array.
--    Both forms work:
--      https://www.tiktok.com/@creator/video/7300000000000000000
--      https://www.tiktok.com/video/7300000000000000000
-- ---------------------------------------------------------------------------
do $$
declare
  links text[] := array[
    'https://www.tiktok.com/@tiktok/video/7106594312292453675'
    -- , 'https://www.tiktok.com/@creator/video/7300000000000000001'
    -- , 'https://www.tiktok.com/@creator/video/7300000000000000002'
  ];
  v_link       text;
  v_id         text;
  v_handle     text;
  v_owner      uuid;
  v_handle_me  text;
  v_added      int := 0;
  v_skipped    int := 0;
begin
  -- Who do these clips belong to?
  select id, handle into v_owner, v_handle_me
  from public.profiles
  where lower(handle) = 'drewmclawhorn3'
  limit 1;

  if v_owner is null then
    raise exception
      'No profile with handle drewmclawhorn3. Create that account first, or change the handle in this script.';
  end if;

  foreach v_link in array links loop
    -- Pull the numeric post id out of the URL.
    v_id := (regexp_match(v_link, '/video/([0-9]{6,25})'))[1];

    if v_id is null then
      raise notice 'skipped (no video id): %', v_link;
      v_skipped := v_skipped + 1;
      continue;
    end if;

    if exists (select 1 from public.videos where tiktok_id = v_id) then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    -- The creator handle, when the link carries one.
    v_handle := (regexp_match(v_link, '/@([A-Za-z0-9._]{2,24})/'))[1];

    insert into public.videos (
      user_id,
      username,
      caption,
      video_url,
      hidden,
      is_tiktok,
      tiktok_id,
      tiktok_author
    )
    values (
      v_owner,
      v_handle_me,
      'TikTok video',
      v_link,
      false,          -- false = published straight into the feed
      true,
      v_id,
      coalesce(v_handle, 'tiktok')
    );

    v_added := v_added + 1;
  end loop;

  raise notice 'added %, skipped %', v_added, v_skipped;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Verification — this is the table you should see at the end.
-- ---------------------------------------------------------------------------
select
  (select count(*) from public.videos where is_tiktok = true)                as tiktok_rows,
  (select count(*) from public.videos where is_tiktok = true
      and tiktok_id is not null)                                            as real_videos,
  (select count(*) from public.videos where is_tiktok = true
      and tiktok_id is not null and hidden = false)                          as live_in_feed,
  (select count(*) from public.videos where is_tiktok = true
      and tiktok_id is null)                                                 as leftover_cards,
  (select handle from public.profiles where id = (
      select user_id from public.videos where is_tiktok = true
        and tiktok_id is not null limit 1))                                  as attributed_to;

-- The most recent five, so you can eyeball the ids.
select id, username, tiktok_author, tiktok_id, hidden, created_at
from public.videos
where is_tiktok = true
order by created_at desc
limit 5;
