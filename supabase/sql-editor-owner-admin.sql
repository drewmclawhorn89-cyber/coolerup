-- ===========================================================================
-- PASTE THIS INTO THE SUPABASE SQL EDITOR (run it once, after the auto-bans
-- script). It fixes "I can't find AI Bot Logs": /admin was hiding the whole
-- page because am_i_admin() only looked at user_roles and the owner account
-- never had an 'admin' row.
--
-- Safe to run more than once.
-- ===========================================================================

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

insert into public.user_roles (user_id, role)
select p.id, 'admin'::public.app_role
from public.profiles p
where lower(btrim(coalesce(p.handle, ''))) = 'drewmclawhorn3'
on conflict (user_id, role) do nothing;

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

-- Quick sanity check: should return true for the owner.
select public.am_i_admin() as i_am_admin;
