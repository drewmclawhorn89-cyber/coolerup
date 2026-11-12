-- Raise the `videos` bucket's per-object size limit.
--
-- Supabase Storage defaults every bucket to a 50 MB per-object cap. That is the
-- real reason a 10-minute (≈500 MB) upload "keeps trying" and then fails: the
-- client happily streams resumable tus chunks for twenty minutes and the final
-- request comes back 413 Payload Too Large. Short clips (10 s ≈ 10 MB) sit
-- under the cap, which is why only long videos broke.
--
-- 1 GiB is enough for a 60-minute 1080p upload. Anything larger is compressed
-- client-side to 720p before it is sent (see src/lib/videoCompression.ts).
--
-- NOTE: a project-wide "Global file size limit" also applies. If the dashboard
-- still shows 50 MB under Storage → Settings, raise it there too — the bucket
-- limit below cannot exceed the global one.

insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', true, 1073741824)
on conflict (id) do update
  set public = true,
      file_size_limit = 1073741824;

-- Keep the existing object policies (public read, authenticated upload) intact.
drop policy if exists "public read videos bucket" on storage.objects;
create policy "public read videos bucket"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'videos');

drop policy if exists "public upload videos bucket" on storage.objects;
create policy "public upload videos bucket"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'videos');

drop policy if exists "public update videos bucket" on storage.objects;
create policy "public update videos bucket"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'videos')
  with check (bucket_id = 'videos');

-- Allow the full 60 minutes the uploader advertises. The original table
-- already capped at 3600, so this is a no-op on fresh databases but repairs
-- any project that still has the older 60-second constraint.
alter table public.full_videos
  drop constraint if exists full_videos_duration_check;

alter table public.full_videos
  add constraint full_videos_duration_check
  check (duration >= 0 and duration <= 3600);
