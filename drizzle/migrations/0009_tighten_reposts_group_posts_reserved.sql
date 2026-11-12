DROP POLICY IF EXISTS "Group posts are public" ON public.group_posts;
CREATE POLICY "Group posts visible in public groups or to members"
  ON public.group_posts FOR SELECT TO anon, authenticated
  USING (
    user_id = auth.uid()
    OR public.is_group_member(group_id)
    OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = group_id AND g.privacy = 'public')
  );

DROP POLICY IF EXISTS "Reposts are public" ON public.reposts;
CREATE POLICY "Reposts of visible videos are readable"
  ON public.reposts FOR SELECT TO anon, authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.videos v WHERE v.id = video_id AND v.hidden = false)
  );

CREATE OR REPLACE FUNCTION public.is_reserved_username(_username text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.reserved_usernames WHERE username = lower(trim(_username)))
$$;
GRANT EXECUTE ON FUNCTION public.is_reserved_username(text) TO anon, authenticated;

DROP POLICY IF EXISTS "reserved usernames are readable by everyone" ON public.reserved_usernames;
REVOKE SELECT ON public.reserved_usernames FROM anon, authenticated;