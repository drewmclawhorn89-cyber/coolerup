DROP POLICY IF EXISTS "Anyone can like group posts" ON public.group_posts;
DROP POLICY IF EXISTS "notifs insert all" ON public.notifications;
CREATE POLICY "notifs insert as actor" ON public.notifications FOR INSERT TO authenticated
  WITH CHECK (actor_user_id = auth.uid());
DROP POLICY IF EXISTS "Anyone can check their own ban" ON public.banned_users;
DROP POLICY IF EXISTS "anyone can read banned" ON public.banned_users;
DROP POLICY IF EXISTS "public can read banned" ON public.banned_users;
CREATE POLICY "admins read bans" ON public.banned_users FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));