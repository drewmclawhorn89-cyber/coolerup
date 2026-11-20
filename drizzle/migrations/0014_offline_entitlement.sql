CREATE OR REPLACE FUNCTION public.my_offline_entitlement()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  with s as (
    select plan from public.subscriptions
     where user_id = auth.uid() and status = 'active'
       and (is_lifetime or current_period_end is null or current_period_end > now())
  )
  select jsonb_build_object(
    'video', public.has_role(auth.uid(), 'admin') or exists (select 1 from s where plan in ('plus','pro','vip','all')),
    'music', public.has_role(auth.uid(), 'admin') or exists (select 1 from s where plan in ('vip','all'))
  )
$$;
REVOKE EXECUTE ON FUNCTION public.my_offline_entitlement() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_offline_entitlement() TO authenticated, service_role;