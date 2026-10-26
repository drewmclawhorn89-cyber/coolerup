ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS links jsonb NOT NULL DEFAULT '{}'::jsonb;
