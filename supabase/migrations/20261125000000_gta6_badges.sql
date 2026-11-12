-- GTA 6 update: permanent "GTA 6 OG 👑" badges.
--
-- The GTA 6 event runs Nov 8 - Nov 15 2026 and never comes back. Anyone who
-- posts a video during the event earns the OG badge, which stays on their
-- profile forever — even after the banner, filter, gift and challenge are gone.
--
-- The award is a security-definer RPC that re-checks the window server-side, so
-- a modified client cannot mint badges after the event ends. There is no other
-- way to insert a row: no insert policy exists on the table.
--
-- Idempotent: re-running the migration won't duplicate rows or replace the
-- function in a breaking way.

create table if not exists public.gta6_badges (
  handle text primary key,
  awarded_at timestamptz not null default now()
);

-- Handles are stored lowercase, matching how profiles are looked up elsewhere.
create unique index if not exists gta6_badges_handle_key on public.gta6_badges (handle);

alter table public.gta6_badges enable row level security;

-- Anyone (signed in or not) can see who has the badge, so profiles render it.
drop policy if exists "gta6 badges are public" on public.gta6_badges;
create policy "gta6 badges are public"
  on public.gta6_badges
  for select
  using (true);

-- No insert/update/delete policies: rows only ever come from award_gta6_badge().

-- ---------------------------------------------------------------------------
-- Award the badge to the signed-in user, once, and only during the event.
-- ---------------------------------------------------------------------------
create or replace function public.award_gta6_badge()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_now timestamptz := now();
  v_start timestamptz := '2026-11-08 00:00:00'::timestamptz;
  v_end timestamptz := '2026-11-15 23:59:59'::timestamptz;
begin
  if v_uid is null then
    return false;
  end if;

  -- One-way door: once the window has closed, nothing can be awarded again.
  if v_now < v_start or v_now > v_end then
    return false;
  end if;

  select lower(replace(p.handle, '@', ''))
    into v_handle
    from public.profiles p
   where p.id = v_uid;

  if v_handle is null or v_handle = '' then
    return false;
  end if;

  insert into public.gta6_badges (handle)
  values (v_handle)
  on conflict (handle) do nothing;

  return true;
end;
$$;

revoke all on function public.award_gta6_badge() from public;
grant execute on function public.award_gta6_badge() to authenticated;

-- The client also reads the table directly; make sure anon can too so a logged
-- out visitor still sees badges on public profiles.
grant select on public.gta6_badges to anon, authenticated;
