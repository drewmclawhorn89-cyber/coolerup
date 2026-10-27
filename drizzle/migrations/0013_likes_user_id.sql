-- Likes are saved per signed-in user (VideoCard inserts video_id + user_id).
ALTER TABLE public.likes ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE public.likes ALTER COLUMN device_id DROP NOT NULL;
ALTER TABLE public.likes DROP CONSTRAINT IF EXISTS likes_pkey;
CREATE UNIQUE INDEX IF NOT EXISTS likes_video_user_key ON public.likes (video_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS likes_video_device_key ON public.likes (video_id, device_id) WHERE device_id IS NOT NULL;
GRANT SELECT, INSERT, DELETE ON public.likes TO authenticated;
DROP POLICY IF EXISTS "likes insertable" ON public.likes;
DROP POLICY IF EXISTS "likes deletable" ON public.likes;
DROP POLICY IF EXISTS "likes insert own" ON public.likes;
DROP POLICY IF EXISTS "likes delete own" ON public.likes;
CREATE POLICY "likes insert own" ON public.likes FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "likes delete own" ON public.likes FOR DELETE TO authenticated USING (user_id = auth.uid());
