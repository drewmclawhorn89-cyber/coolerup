-- ===========================================================================
-- 20261228000000 · DM MEDIA STORAGE: `direct-messages` BUCKET + POLICIES
--
-- Fixes "Bucket not found" when sending a photo or video in Messages.
--
-- 1. Provisions the `direct-messages` bucket as PUBLIC so the URL returned by
--    `getPublicUrl()` renders directly in chat (no signed URL round-trip).
-- 2. Grants INSERT / SELECT / UPDATE / DELETE on `direct-messages` to both
--    `authenticated` and `anon` (the app can be used before sign-in is
--    resolved, and DM media is already gated by the DM privacy trigger).
-- 3. Re-asserts the same four grants on the existing `videos` bucket, which is
--    the fallback used when a project has no `direct-messages` bucket. `videos`
--    is already public and already allows read/insert/update; this adds the
--    missing DELETE grant and keeps everything idempotent.
--
-- Both buckets are written to by `uploadDmMediaFile()` in src/lib/dmMedia.ts:
--   path = dm/<timestamp>_<filename>
--   stored value = the bucket's public URL in direct_messages.media_url
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. `direct-messages` bucket (public, 100 MB per object)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'direct-messages',
  'direct-messages',
  true,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-m4v'
  ]
)
on conflict (id) do update
  set public = true,
      file_size_limit = 104857600;

-- ---------------------------------------------------------------------------
-- 2. `direct-messages` object policies (authenticated + anon, all four verbs)
-- ---------------------------------------------------------------------------

drop policy if exists "direct-messages read" on storage.objects;
create policy "direct-messages read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'direct-messages');

drop policy if exists "direct-messages insert" on storage.objects;
create policy "direct-messages insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'direct-messages');

drop policy if exists "direct-messages update" on storage.objects;
create policy "direct-messages update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'direct-messages')
  with check (bucket_id = 'direct-messages');

drop policy if exists "direct-messages delete" on storage.objects;
create policy "direct-messages delete"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'direct-messages');

-- ---------------------------------------------------------------------------
-- 3. `videos` bucket fallback: same four grants (adds the missing DELETE)
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('videos', 'videos', true, 1073741824)
on conflict (id) do update
  set public = true,
      file_size_limit = 1073741824;

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

drop policy if exists "public delete videos bucket" on storage.objects;
create policy "public delete videos bucket"
  on storage.objects for delete
  to anon, authenticated
  using (bucket_id = 'videos');

notify pgrst, 'reload schema';
