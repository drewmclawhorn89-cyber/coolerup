-- =====================================================================
-- Coolerup · Attribute every pulled TikTok video to ONE Coolerup account
--
-- Paste the whole file into the Supabase SQL Editor and press Run.
-- Safe to re-run.
--
-- What it does:
--   1. Finds the account whose profile handle is @drewmclawhorn3.
--   2. Pins it as the TikTok sync owner (tiktok_sync_settings.owner_user_id).
--   3. Rewrites every existing TikTok row so it is posted BY that account.
--      The TikTok creator is preserved in `tiktok_author`, so you do not
--      lose attribution - the card just no longer pretends to be them.
--
-- If step 1 finds nothing, nothing else runs and you get a clear message.
-- =====================================================================

-- ---------------------------------------------------------------------
-- The handle to attribute to. Change this one line if you ever want a
-- different account.
-- ---------------------------------------------------------------------
do $$
declare
  v_handle   text := 'drewmclawhorn3';
  v_user_id  uuid;
  v_rows     integer;
  v_card     integer;
begin
  -- 1. Resolve the account.
  select id into v_user_id
  from public.profiles
  where lower(handle) = lower(v_handle)
  limit 1;

  if v_user_id is null then
    raise exception
      'No profile has handle "%". Check the exact spelling in public.profiles (select id, handle from public.profiles;).',
      v_handle;
  end if;

  raise notice 'Attributing TikTok videos to @% (user %)', v_handle, v_user_id;

  -- 2. Pin the sync owner so future pulls go to this account.
  update public.tiktok_sync_settings
     set owner_user_id = v_user_id
   where id = 1;

  if not found then
    insert into public.tiktok_sync_settings (id, owner_user_id)
    values (1, v_user_id)
    on conflict (id) do update set owner_user_id = excluded.owner_user_id;
  end if;

  -- 3. Rewrite the rows that already exist.
  --    `username` is what the feed card labels itself with, so it must be the
  --    Coolerup handle. `tiktok_author` keeps the original creator.
  update public.videos
     set user_id  = v_user_id,
         username = v_handle,
         tiktok_author = coalesce(tiktok_author, username)
   where is_tiktok = true;

  get diagnostics v_rows = row_count;

  -- Creator embed cards have no tiktok_id; count them separately so the
  -- report is honest about what is in the feed.
  select count(*) into v_card
  from public.videos
  where is_tiktok = true and tiktok_id is null;

  raise notice 'Updated % TikTok row(s); % of them are creator embed cards.', v_rows, v_card;
end
$$;

-- ---------------------------------------------------------------------
-- Verify. Every row should show the same poster_handle.
-- ---------------------------------------------------------------------
select
  v.username              as poster_handle,
  v.tiktok_author         as original_tiktok_creator,
  case when v.tiktok_id is null then 'creator card' else 'video' end as kind,
  v.hidden,
  v.created_at
from public.videos v
where v.is_tiktok = true
order by v.created_at desc
limit 50;

-- And the pinned owner:
select
  s.owner_user_id,
  p.handle as owner_handle,
  p.display_name
from public.tiktok_sync_settings s
left join public.profiles p on p.id = s.owner_user_id
where s.id = 1;
