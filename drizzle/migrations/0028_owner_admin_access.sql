-- ---------------------------------------------------------------------------
-- 0028_owner_admin_access.sql
--
-- Why this exists:
--   /admin gates the whole page (and therefore the "AI Bot Logs" tab) behind
--   public.am_i_admin(), and am_i_admin() only checked user_roles for the
--   'admin' role. The owner account @drewmclawhorn3 was never given that row,
--   so the owner saw "Admins only" and could not find AI Bot Logs at all.
--
-- This migration:
--   1. treats the owner as an admin in am_i_admin();
--   2. gives the owner a real 'admin' row in user_roles so every existing
--      has_role(auth.uid(),'admin') RLS policy works for them too;
--   3. lets the owner read admin_bot_logs() even if the role row is missing.
-- Idempotent: safe to run more than once.
-- ---------------------------------------------------------------------------

-- 1. Owner counts as an admin for the /admin page gate.
create or replace function public.am_i_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.has_role(auth.uid(), 'admin')
      or public.is_owner_uid(auth.uid());
$$;

grant execute on function public.am_i_admin() to authenticated, service_role;

-- 2. Materialise the admin role for the owner account.
insert into public.user_roles (user_id, role)
select p.id, 'admin'::public.app_role
from public.profiles p
where lower(btrim(coalesce(p.handle, ''))) = 'drewmclawhorn3'
on conflict (user_id, role) do nothing;

-- 3. AI Bot Logs readable by admins and by the owner.
create or replace function public.admin_bot_logs(p_limit integer default 200)
returns table (
  id uuid,
  username text,
  user_id uuid,
  action text,
  reason text,
  kind text,
  content_type text,
  content_id uuid,
  content_excerpt text,
  strike_count integer,
  is_permanent boolean,
  expires_at timestamptz,
  auto boolean,
  actor text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not (public.has_role(auth.uid(), 'admin') or public.is_owner_uid(auth.uid())) then
    raise exception 'not_authorized';
  end if;

  return query
  select
    l.id,
    l.username,
    l.user_id,
    l.action,
    l.reason,
    l.kind,
    l.content_type,
    l.content_id,
    l.content_excerpt,
    l.strike_count,
    l.is_permanent,
    l.expires_at,
    l.auto,
    l.actor,
    l.created_at
  from public.moderation_log l
  where l.auto = true
  order by l.created_at desc
  limit greatest(1, least(coalesce(p_limit, 200), 1000));
end;
$$;

grant execute on function public.admin_bot_logs(integer) to authenticated;

notify pgrst, 'reload schema';
