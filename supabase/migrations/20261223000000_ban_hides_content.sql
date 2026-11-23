-- ---------------------------------------------------------------------------
-- Banned accounts disappear from every feed, grid and search result
--
-- Before this, a ban stopped the account from signing in (BanGate) but every
-- video they had already posted stayed visible: in the For You shuffle, in
-- search, on their profile grid, in "related videos", and through a direct
-- link. This migration removes them from all of those at once, at the data
-- layer, so no client query can bring them back.
--
-- Three parts:
--   1. account_is_banned()      — one place that decides "is this author banned"
--   2. RESTRICTIVE select policies on videos / full_videos — every read is
--      filtered, including ones written after this migration
--   3. a trigger on banned_users — flips existing rows to hidden so the
--      `hidden = false` filters and the service role agree with RLS
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Is this account currently banned?
-- ---------------------------------------------------------------------------
-- A ban row can be keyed by user_id (auto bans) or only by username (older
-- admin bans), so both are checked. An expired temporary ban is not a ban.
create or replace function public.account_is_banned(_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select exists (
        select 1
        from public.banned_users b
        where (
            (_uid is not null and b.user_id = _uid)
            or (
              _uid is not null
              and btrim(coalesce(b.username, '')) <> ''
              and regexp_replace(lower(btrim(b.username)), '^@+', '') = (
                select regexp_replace(lower(btrim(p.handle)), '^@+', '')
                from public.profiles p
                where p.id = _uid
              )
            )
          )
          and (
            b.is_permanent
            or b.expires_at is null
            or b.expires_at > now()
          )
      )
    ),
    false
  );
$$;

grant execute on function public.account_is_banned(uuid) to anon, authenticated;

-- Same question, asked with a handle instead of an id.
create or replace function public.handle_is_banned(_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select exists (
        select 1
        from public.banned_users b
        where regexp_replace(lower(btrim(b.username)), '^@+', '')
            = regexp_replace(lower(btrim(coalesce(_username, ''))), '^@+', '')
          and (
            b.is_permanent
            or b.expires_at is null
            or b.expires_at > now()
          )
      )
    ),
    false
  );
$$;

grant execute on function public.handle_is_banned(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The list of banned handles, for client-side belt-and-braces filtering
-- ---------------------------------------------------------------------------
-- Only handles are returned — no reasons, dates or ids — and only so the app
-- can drop rows from a list it has already fetched. RLS below is the real
-- enforcement; this just keeps a stale cached page from showing a banned
-- creator for a moment after a ban lands.
create or replace function public.banned_handles()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select distinct regexp_replace(lower(btrim(b.username)), '^@+', '')
  from public.banned_users b
  where btrim(coalesce(b.username, '')) <> ''
    and (
      b.is_permanent
      or b.expires_at is null
      or b.expires_at > now()
    );
$$;

grant execute on function public.banned_handles() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. RESTRICTIVE select policies
-- ---------------------------------------------------------------------------
-- A restrictive policy ANDs with whatever permissive policy already exists, so
-- this does not need to know or replace the existing "anyone can read videos"
-- rules. Admins keep access so the moderation screens still work.
--
-- `user_id` can be null on very old rows; those stay visible because there is
-- no account to check.
drop policy if exists "banned authors are hidden" on public.videos;
create policy "banned authors are hidden"
  on public.videos
  as restrictive
  for select
  to anon, authenticated
  using (
    user_id is null
    or not public.account_is_banned(user_id)
    or public.has_role(auth.uid(), 'admin')
  );

drop policy if exists "banned authors are hidden" on public.full_videos;
create policy "banned authors are hidden"
  on public.full_videos
  as restrictive
  for select
  to anon, authenticated
  using (
    user_id is null
    or not public.account_is_banned(user_id)
    or public.has_role(auth.uid(), 'admin')
  );

-- ---------------------------------------------------------------------------
-- 4. Flip existing rows to hidden when a ban is applied
-- ---------------------------------------------------------------------------
-- RLS already stops these rows from being read by the app, but the `hidden`
-- flag is what the feed shuffle, the search query and the service role look
-- at. Setting it keeps every path consistent, and lets an unban restore
-- exactly the rows the ban took down.
create or replace function public.ban_hides_author_content()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  author uuid;
  handle text;
begin
  if tg_op = 'DELETE' then
    author := old.user_id;
    handle := regexp_replace(lower(btrim(coalesce(old.username, ''))), '^@+', '');

    -- Only restore what this ban hid, and only if no other active ban remains.
    if not public.account_is_banned(author) and not public.handle_is_banned(handle) then
      update public.videos
         set hidden = false,
             hidden_reason = null
       where hidden_reason = 'Author banned'
         and (
           (author is not null and user_id = author)
           or (
             handle <> ''
             and regexp_replace(lower(btrim(coalesce(username, ''))), '^@+', '') = handle
           )
         );
    end if;
    return old;
  end if;

  author := new.user_id;
  handle := regexp_replace(lower(btrim(coalesce(new.username, ''))), '^@+', '');

  update public.videos
     set hidden = true,
         hidden_reason = 'Author banned'
   where hidden is distinct from true
     and (
       (author is not null and user_id = author)
       or (
         handle <> ''
         and regexp_replace(lower(btrim(coalesce(username, ''))), '^@+', '') = handle
       )
     );

  return new;
end;
$$;

drop trigger if exists ban_hides_author_content on public.banned_users;
create trigger ban_hides_author_content
  after insert or update of expires_at, is_permanent, user_id, username
  on public.banned_users
  for each row
  execute function public.ban_hides_author_content();

drop trigger if exists unban_restores_author_content on public.banned_users;
create trigger unban_restores_author_content
  after delete
  on public.banned_users
  for each row
  execute function public.ban_hides_author_content();

-- ---------------------------------------------------------------------------
-- 5. Backfill: hide content for every ban that is already active
-- ---------------------------------------------------------------------------
update public.videos v
   set hidden = true,
       hidden_reason = 'Author banned'
 where v.hidden is distinct from true
   and (
     public.account_is_banned(v.user_id)
     or public.handle_is_banned(v.username)
   );
