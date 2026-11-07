CREATE OR REPLACE FUNCTION public.is_group_member(_group_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.group_members WHERE group_id = _group_id AND user_id = _user_id)
$$;
DROP POLICY IF EXISTS "Groups are public" ON public.groups;
CREATE POLICY "Public groups or own/member groups are readable" ON public.groups FOR SELECT TO anon, authenticated
USING (privacy = 'public' OR creator_id = auth.uid() OR public.is_group_member(id, auth.uid()));