-- TikTok ingestion lands in the short-form feed, not the long-form library.
--
-- The first pass wrote ingested rows into `full_videos` (the horizontal grid at
-- /videos). That was the wrong home: TikTok clips are vertical, short, and
-- belong in the swipe feed that `videos` drives. This migration moves the
-- provenance columns onto `videos` so the sync engine can insert there.
--
-- Nothing is rehosted. `video_url` holds the canonical TikTok share URL and
-- playback happens through TikTok's own embed player, same rule the YouTube
-- additions follow. That keeps the storage bucket for things the app owns and
-- keeps us inside TikTok's terms of service.
--
-- `videos.user_id` is nullable, so an ingested row does not strictly need an
-- owning account. The engine still sets one when it can, because the feed
-- resolves the poster's handle through `user_id -> profiles.handle`.

alter table public.videos
  add column if not exists is_tiktok boolean not null default false,
  add column if not exists tiktok_id text,
  add column if not exists tiktok_author text;

-- One row per TikTok video, no matter how many sources surface it. The partial
-- index lets the sync job treat a duplicate as a skip rather than an error, and
-- makes the "already have this one" check an index lookup instead of a scan.
create unique index if not exists videos_tiktok_id_key
  on public.videos (tiktok_id)
  where tiktok_id is not null;

-- The feed pages newest-first and shuffles ids; this keeps the "is it TikTok"
-- filter cheap when the admin panel counts ingested rows.
create index if not exists videos_is_tiktok_idx
  on public.videos (is_tiktok, created_at desc);

-- Ask PostgREST to pick up the new columns immediately.
notify pgrst, 'reload schema';
