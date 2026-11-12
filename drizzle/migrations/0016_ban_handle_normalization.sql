-- 0016_ban_handle_normalization.sql
--
-- BUG: bans were being stored with the leading "@" (e.g. '@bot095') while
-- public.profiles.handle stores the bare handle ('bot095'). Every ban check
-- used an exact string comparison, so those bans silently never applied —
-- the account kept full access.
--
-- Fix:
--   1. public.norm_handle() — one canonical form: lowercase, trimmed, no "@".
--   2. A BEFORE INSERT/UPDATE trigger on banned_users so any future ban is
--      normalized no matter how it is typed ("@Bot095", " bot095 ", "BOT095").
--   3. Backfill existing rows, de-duplicating any that collapse together.
--   4. Rewrite every ban helper to compare normalized handles.
--
-- Idempotent: safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Canonical handle form
-- ---------------------------------------------------------------------------

create or replace function public.norm_handle(_handle text)
returns text
language sql
immutable
as $$
  select lower(regexp_replace(btrim(coalesce(_handle, '')), '^@+', ''))
$$;

grant execute on function public.norm_handle(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Normalize on write
-- ---------------------------------------------------------------------------

create or replace function public.normalize_ban_username()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.username := public.norm_handle(new.username);
  return new;
end;
$$;

drop trigger if exists banned_users_normalize_username on public.banned_users;
create trigger banned_users_normalize_username
  before insert or update of username on public.banned_users
  for each row execute function public.normalize_ban_username();

-- ---------------------------------------------------------------------------
-- 3. Backfill existing bans (de-duplicate first so the UNIQUE constraint holds)
-- ---------------------------------------------------------------------------

do $$
begin
  delete from public.banned_users b
  where b.id in (
    select id
    from (
      select id,
             row_number() over (
               partition by public.norm_handle(username)
               order by is_permanent desc, banned_at desc
             ) as rn
      from public.banned_users
    ) ranked
    where rn > 1
  );

  update public.banned_users
     set username = public.norm_handle(username)
   where username is distinct from public.norm_handle(username);
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Ban helpers compare normalized handles
-- ---------------------------------------------------------------------------

create or replace function public.is_banned(_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.banned_users
    where public.norm_handle(username) = public.norm_handle(_username)
      and (is_permanent or expires_at is null or expires_at > now())
  )
$$;

create or replace function public.is_banned_username(_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.banned_users
    where public.norm_handle(username) = public.norm_handle(_username)
      and (is_permanent or expires_at is null or expires_at > now())
  )
$$;

create or replace function public.is_banned_uid(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    join public.banned_users b
      on public.norm_handle(b.username) = public.norm_handle(p.handle)
    where p.id = _uid
      and (b.is_permanent or b.expires_at is null or b.expires_at > now())
  )
$$;

create or replace function public.my_ban_status()
returns table (
  is_banned boolean,
  reason text,
  is_permanent boolean,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    true as is_banned,
    b.reason,
    b.is_permanent,
    b.expires_at
  from public.profiles p
  join public.banned_users b
    on public.norm_handle(b.username) = public.norm_handle(p.handle)
  where p.id = auth.uid()
    and (b.is_permanent or b.expires_at is null or b.expires_at > now())
  limit 1
$$;

-- Handle-based status lookup, used by the client as a fallback when the
-- profile row is missing or the join above finds nothing.
create or replace function public.ban_status_for_handle(_handle text)
returns table (
  is_banned boolean,
  reason text,
  is_permanent boolean,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    true as is_banned,
    b.reason,
    b.is_permanent,
    b.expires_at
  from public.banned_users b
  where public.norm_handle(b.username) = public.norm_handle(_handle)
    and (b.is_permanent or b.expires_at is null or b.expires_at > now())
  limit 1
$$;

grant execute on function public.is_banned(text) to anon, authenticated, service_role;
grant execute on function public.is_banned_username(text) to anon, authenticated, service_role;
grant execute on function public.is_banned_uid(uuid) to anon, authenticated, service_role;
grant execute on function public.my_ban_status() to authenticated, service_role;
grant execute on function public.ban_status_for_handle(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Refresh PostgREST's schema cache
-- ---------------------------------------------------------------------------

notify pgrst, 'reload schema';
