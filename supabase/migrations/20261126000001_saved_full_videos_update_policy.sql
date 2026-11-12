-- Saving a video failed with
--   new row violates row-level security policy (USING expression)
--   for table "saved_full_videos"
--
-- because the table shipped with select/insert/delete policies but no update
-- policy, and the client saved with an upsert. An upsert is
-- `INSERT ... ON CONFLICT DO UPDATE`, and the DO UPDATE half is checked
-- against the UPDATE policy — so the write was refused even though the row
-- being written was the user's own.
--
-- The client now inserts and treats 23505 (already saved) as success, so this
-- is no longer on the hot path. The policy stays anyway: it makes the table
-- behave the way its name implies, and any older client or future
-- `on conflict do update` keeps working.

alter table public.saved_full_videos enable row level security;

drop policy if exists "Users update their own saved full videos" on public.saved_full_videos;
create policy "Users update their own saved full videos"
  on public.saved_full_videos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Re-assert the rest, so a database that only ever ran part of the original
-- script ends up complete.
drop policy if exists "Users read own saved full videos" on public.saved_full_videos;
create policy "Users read own saved full videos"
  on public.saved_full_videos for select
  using (auth.uid() = user_id);

drop policy if exists "Users save their own full videos" on public.saved_full_videos;
create policy "Users save their own full videos"
  on public.saved_full_videos for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users unsave their own full videos" on public.saved_full_videos;
create policy "Users unsave their own full videos"
  on public.saved_full_videos for delete
  using (auth.uid() = user_id);
