-- ============================================================================
-- Coolerup — fix "Upload failed" when posting
-- ============================================================================
-- Paste this whole file into the Supabase SQL Editor and press Run.
-- It is idempotent: safe to run as many times as you like.
--
-- Posting writes two things:
--   1. the file itself  -> Storage bucket "videos"
--   2. a row            -> public.videos
-- If either is missing or locked down, the app used to show a generic
-- "Upload failed. Try again." This script repairs the Storage side, which is
-- the usual culprit, and then tells you what it found.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. The bucket
-- ----------------------------------------------------------------------------
-- Public read so <video src> works without signing every URL.
-- 1 GiB per object so long uploads do not die at the default 50 MB cap.
insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', true, 1073741824)
on conflict (id) do update
  set public = true,
      file_size_limit = 1073741824;

-- ----------------------------------------------------------------------------
-- 2. Storage policies
-- ----------------------------------------------------------------------------
-- Read: everyone (the bucket is public).
drop policy if exists "public read videos bucket" on storage.objects;
create policy "public read videos bucket"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'videos');

-- Upload: any signed-in user. Anonymous uploads are rejected on purpose.
drop policy if exists "public upload videos bucket" on storage.objects;
create policy "public upload videos bucket"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'videos');

-- Overwrite / resume: same rule.
drop policy if exists "public update videos bucket" on storage.objects;
create policy "public update videos bucket"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'videos')
  with check (bucket_id = 'videos');

-- ----------------------------------------------------------------------------
-- 3. The videos table has to accept the row
-- ----------------------------------------------------------------------------
-- RLS on public.videos must let a signed-in user insert. The app does not send
-- a user_id, so the check is simply "you are authenticated".
--
-- Wrapped in a guard so the script never aborts halfway if the table has not
-- been created yet in this project.
do $$
begin
  if to_regclass('public.videos') is null then
    raise notice 'public.videos does not exist - skipping table policies.';
    return;
  end if;

  execute 'alter table public.videos enable row level security';

  execute 'drop policy if exists "authenticated can post videos" on public.videos';
  execute 'create policy "authenticated can post videos"
             on public.videos for insert
             to authenticated
             with check (true)';

  execute 'drop policy if exists "anyone can read videos" on public.videos';
  execute 'create policy "anyone can read videos"
             on public.videos for select
             to anon, authenticated
             using (true)';

  execute 'grant select, insert on public.videos to authenticated';
  execute 'grant select on public.videos to anon';
end
$$;

-- ----------------------------------------------------------------------------
-- 4. Report what you have
-- ----------------------------------------------------------------------------
-- Expect one row: videos | public = true | 1073741824
select
  b.id                                   as bucket,
  b.public                               as is_public,
  b.file_size_limit                      as max_object_bytes,
  (select count(*) from storage.objects o where o.bucket_id = b.id) as objects
from storage.buckets b
where b.id = 'videos';

-- Expect four rows: read / upload / update on storage.objects, plus the two
-- videos-table policies. If this comes back empty, the policies did not apply.
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where (schemaname = 'storage' and tablename = 'objects' and policyname ilike '%videos%')
   or (schemaname = 'public'  and tablename = 'videos')
order by schemaname, policyname;

-- Does the table the app inserts into actually exist?
-- Expect: videos_table_exists = true
select to_regclass('public.videos') is not null as videos_table_exists;

-- ----------------------------------------------------------------------------
-- 5. If uploads still fail
-- ----------------------------------------------------------------------------
-- Supabase also enforces a project-wide "Global file size limit"
-- (Dashboard -> Storage -> Settings). The bucket limit above cannot exceed it.
-- If the dashboard still says 50 MB, raise it there too.
--
-- To see the exact error the app now reports, open the browser devtools
-- Console while posting: the toast shows a specific reason (too big, session
-- expired, permission denied, connection dropped) instead of the old
-- catch-all message.
