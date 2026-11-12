-- Security fix: sounds table RLS + sounds/gifs storage ownership
--
-- The old `sounds` policies were wide open: any signed-in user could INSERT,
-- and any signed-in user could UPDATE *every* row (the check was only
-- `auth.uid() is not null`). That let anyone rewrite another creator's song
-- title, audio_url or uses_count. This migration replaces those with strict
-- owner-scoped rules and adds the missing `user_id` column the rules need.
--
-- Access model:
--   SELECT  everyone (anon + authenticated)  -> the Music tab keeps working
--   INSERT  owner only  (user_id = auth.uid())
--   UPDATE  owner only  (user_id = auth.uid())
--   DELETE  owner only  (user_id = auth.uid())
--   Admin   @drewmclawhorn3 can do all of the above
--
-- Storage (`sounds` and `gifs` buckets):
--   SELECT  everyone
--   INSERT/UPDATE/DELETE  only into a folder named after the caller's uid,
--                         i.e. (storage.foldername(name))[1] = auth.uid()::text
--
-- The SECURITY DEFINER helpers (`create_sound_from_video`, `set_video_sound`,
-- `increment_sound_use`) run as the table owner and bypass RLS, so the upload
-- trigger and the "use this sound" counter keep working unchanged.

-- ---------------------------------------------------------------------------
-- 1. Ownership column
-- ---------------------------------------------------------------------------

alter table public.sounds
  add column if not exists user_id uuid references public.profiles (id) on delete cascade;

-- Backfill from the source video. Library sounds (creator 'coolerup', no
-- original video) and pre-existing YouTube songs stay null — they are shared
-- catalogue rows that only an admin can edit.
update public.sounds s
   set user_id = v.user_id
  from public.videos v
 where v.id = s.original_video_id
   and s.user_id is null;

create index if not exists sounds_user_id_idx on public.sounds (user_id);

-- ---------------------------------------------------------------------------
-- 2. Admin flag + helper
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Keep the existing handle-based owner in sync with the new flag.
update public.profiles
   set is_admin = true
 where lower(replace(handle, '@', '')) = 'drewmclawhorn3';

-- One place to ask "is the caller an admin?". SECURITY DEFINER so the lookup
-- on profiles works even when the caller cannot read that row directly, and
-- STABLE so Postgres can cache it within a statement.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and (
        is_admin
        -- Fallback so the owner keeps access even if the flag is ever reset.
        or lower(replace(handle, '@', '')) = 'drewmclawhorn3'
      )
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. sounds RLS
-- ---------------------------------------------------------------------------

alter table public.sounds enable row level security;

-- Remove the old, over-permissive policies.
drop policy if exists "sounds are public" on public.sounds;
drop policy if exists "signed in users create sounds" on public.sounds;
drop policy if exists "creators update own sounds" on public.sounds;

-- Remove any previous versions of the new policies so this is re-runnable.
drop policy if exists "public read sounds" on public.sounds;
drop policy if exists "owner insert sounds" on public.sounds;
drop policy if exists "owner update sounds" on public.sounds;
drop policy if exists "owner delete sounds" on public.sounds;
drop policy if exists "admin manage sounds" on public.sounds;

-- Everyone can read: the Music tab, search and the sound picker all need this.
create policy "public read sounds"
  on public.sounds for select
  to anon, authenticated
  using (true);

-- Only the owner can create a sound that belongs to them.
create policy "owner insert sounds"
  on public.sounds for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Only the owner can edit their own sound. The WITH CHECK stops an owner from
-- handing the row to someone else (user_id must still be theirs afterwards).
create policy "owner update sounds"
  on public.sounds for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Only the owner can delete their own sound.
create policy "owner delete sounds"
  on public.sounds for delete
  to authenticated
  using (auth.uid() = user_id);

-- Admin override: @drewmclawhorn3 can read, insert, update and delete any row.
-- Permissive policies are OR-ed together, so this only widens access for admins.
create policy "admin manage sounds"
  on public.sounds for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

grant select on public.sounds to anon, authenticated;
grant insert, update, delete on public.sounds to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Keep the definer helper writing the owner
-- ---------------------------------------------------------------------------

-- Re-create the auto-sound function so new rows carry user_id. Everything else
-- is unchanged; the function is SECURITY DEFINER and therefore bypasses RLS.
create or replace function public.create_sound_from_video(_video_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.videos%rowtype;
  s_id uuid;
  t text;
begin
  select * into v from public.videos where id = _video_id;
  if not found then
    return null;
  end if;

  -- Photos have no audio track.
  if v.video_url ~* '\.(jpe?g|png|webp|gif|avif)(\?|#|$)' then
    return null;
  end if;

  -- Only the owner (or a trusted server call) may create the sound.
  if auth.uid() is not null
     and v.user_id is distinct from auth.uid()
     and not public.is_admin()
     and not exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.handle = v.username
     ) then
    raise exception 'not your video';
  end if;

  t := public.sound_title_for_video(v.caption, v.username);

  -- If the video already borrowed someone else's sound, its own original sound
  -- exists but has zero uses (nobody is playing it yet).
  insert into public.sounds (original_video_id, audio_url, title, creator_username, uses_count, user_id)
  values (v.id, v.video_url, left(t, 140), v.username, case when v.sound_id is null then 1 else 0 end, v.user_id)
  on conflict (original_video_id) do update
    set audio_url = excluded.audio_url,
        title = coalesce(nullif(public.sounds.title, ''), excluded.title),
        creator_username = excluded.creator_username,
        user_id = coalesce(public.sounds.user_id, excluded.user_id)
  returning id into s_id;

  update public.videos
     set sound_id = s_id
   where id = v.id
     and (sound_id is null or sound_id = s_id);

  return s_id;
end;
$$;

grant execute on function public.create_sound_from_video(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Storage: sounds bucket
-- ---------------------------------------------------------------------------

-- Public read (the Music tab streams these), but writes are owner-only. 25 MB
-- is plenty for a single audio track.
insert into storage.buckets (id, name, public, file_size_limit)
values ('sounds', 'sounds', true, 26214400)
on conflict (id) do update
  set public = true,
      file_size_limit = 26214400;

drop policy if exists "public read sounds bucket" on storage.objects;
create policy "public read sounds bucket"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'sounds');

-- Objects live under `{user_id}/...`, so a user can only write into their own
-- folder — never into another creator's.
drop policy if exists "users upload their own sounds" on storage.objects;
create policy "users upload their own sounds"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'sounds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users update their own sound objects" on storage.objects;
create policy "users update their own sound objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'sounds'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'sounds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own sound objects" on storage.objects;
create policy "users delete their own sound objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'sounds'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 6. Storage: gifs bucket — add the missing UPDATE policy
-- ---------------------------------------------------------------------------

-- The gifs migration already locks INSERT/DELETE to `{user_id}/...`; UPDATE was
-- never covered, so a user could overwrite another user's GIF object. Add the
-- same folder check for updates (re-runnable).
drop policy if exists "users update their own gif objects" on storage.objects;
create policy "users update their own gif objects"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'gifs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'gifs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
