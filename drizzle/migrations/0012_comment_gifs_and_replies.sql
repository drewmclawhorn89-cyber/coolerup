ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS gif_url text CHECK (gif_url IS NULL OR (char_length(gif_url) <= 500 AND gif_url ~ '^https://'));
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.comments(id) ON DELETE CASCADE;
ALTER TABLE public.comments DROP CONSTRAINT IF EXISTS comments_body_check;
ALTER TABLE public.comments ADD CONSTRAINT comments_body_check CHECK (char_length(body) <= 300 AND (char_length(body) >= 1 OR gif_url IS NOT NULL));
CREATE INDEX IF NOT EXISTS comments_parent_id_idx ON public.comments(parent_id);
