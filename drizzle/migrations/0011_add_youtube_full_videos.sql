ALTER TABLE public.full_videos ADD COLUMN IF NOT EXISTS is_youtube boolean NOT NULL DEFAULT false;
ALTER TABLE public.full_videos ADD COLUMN IF NOT EXISTS youtube_id text;
ALTER TABLE public.full_videos ADD CONSTRAINT full_videos_youtube_source CHECK (NOT is_youtube OR (youtube_id IS NOT NULL AND youtube_id ~ '^[A-Za-z0-9_-]{1,64}$'));