DROP POLICY IF EXISTS "Reposts are public" ON public.reposts;

DROP POLICY IF EXISTS "Saved videos are public" ON public.saved_videos;
CREATE POLICY "Users read own saved videos" ON public.saved_videos FOR SELECT TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "group post likes are public" ON public.group_post_likes;
CREATE POLICY "Likes on visible group posts are readable" ON public.group_post_likes FOR SELECT TO anon, authenticated
USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM public.group_posts gp WHERE gp.id = group_post_likes.post_id));

CREATE TABLE public.beta_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_name text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT false,
  tested_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.beta_features TO authenticated;
GRANT ALL ON public.beta_features TO service_role;
ALTER TABLE public.beta_features ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage beta features" ON public.beta_features FOR ALL TO authenticated
USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));