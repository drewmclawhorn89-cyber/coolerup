-- 0018_app_status.sql
-- The maintenance kill switch, made usable.
--
-- `app_settings.is_maintenance` / `maintenance_message` have been in the schema
-- since 0000 but nothing ever read them, and 0004 revoked all access from anon
-- (correctly — it is an admin table). That left no way for a signed-out visitor
-- to learn the app is down.
--
-- So: one security-definer read function that exposes ONLY the three
-- maintenance columns to everyone, and one admin-only write function.

-- Public read: maintenance flag + message + when it last changed.
create or replace function public.app_status()
returns table (
  is_maintenance boolean,
  maintenance_message text,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(s.is_maintenance, false),
    s.maintenance_message,
    s.updated_at
  from (values (1)) as v(id)
  left join public.app_settings s on s.id = v.id;
$$;

revoke all on function public.app_status() from public;
grant execute on function public.app_status() to anon, authenticated;

-- Admin-only write. A null/blank `_message` falls back to the client's default
-- copy, so the switch can be flipped with one call and no text.
create or replace function public.set_app_status(
  _maintenance boolean,
  _message text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admins only';
  end if;

  insert into public.app_settings (id, is_maintenance, maintenance_message, updated_at)
  values (1, _maintenance, nullif(btrim(coalesce(_message, '')), ''), now())
  on conflict (id) do update
    set is_maintenance = excluded.is_maintenance,
        maintenance_message = excluded.maintenance_message,
        updated_at = now();
end;
$$;

revoke all on function public.set_app_status(boolean, text) from public;
grant execute on function public.set_app_status(boolean, text) to authenticated;
