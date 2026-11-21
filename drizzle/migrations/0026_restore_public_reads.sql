-- 0013_security_fixes_round2 tightened reads so far that signed-out visitors
-- could not read the feed: it replaced "videos readable" (anon) with
-- "owners read own videos" (authenticated, own rows only), and limited storage
-- reads to signed-in users. The result was an empty feed for every logged-out
-- visitor, which is most first-time visitors.
--
-- These policies restore public read of the feed while keeping writes locked
-- down, and keep banned users' content hidden.

-- videos: anyone may read; writes stay restricted by the existing insert policy.
DROP POLICY IF EXISTS "owners read own videos" ON public.videos;
DROP POLICY IF EXISTS "anyone reads feed videos" ON public.videos;
CREATE POLICY "anyone reads feed videos" ON public.videos FOR SELECT TO anon, authenticated
  USING (NOT public.is_banned(username) OR auth.uid() = user_id);

-- profiles: already covered by "profiles of non-banned users", but the table
-- grant is required for anon to read it at all.
GRANT SELECT ON public.profiles TO anon, authenticated;

-- app_settings: the app reads feature flags before sign-in.
DROP POLICY IF EXISTS "public read app_settings" ON public.app_settings;
CREATE POLICY "public read app_settings" ON public.app_settings FOR SELECT TO anon, authenticated
  USING (true);

-- messages stay private to their participants.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO authenticated;

-- storage: media buckets are public-read so <video>/<img> tags work signed out.
DROP POLICY IF EXISTS "signed in read media buckets" ON storage.objects;
DROP POLICY IF EXISTS "anyone reads video and avatar files" ON storage.objects;
CREATE POLICY "anyone reads video and avatar files" ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('videos','avatars','groups','marketplace','gifs'));
