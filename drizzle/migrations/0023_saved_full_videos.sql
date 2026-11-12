-- Persistent "Save" state for full-length videos.
-- public.saved_videos references public.videos, so full-video ids cannot live
-- there; this table mirrors it for public.full_videos.

create table if not exists public.saved_full_videos (
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id uuid not null references public.full_videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index if not exists saved_full_videos_video_idx
  on public.saved_full_videos (video_id);

create index if not exists saved_full_videos_user_idx
  on public.saved_full_videos (user_id, created_at desc);

alter table public.saved_full_videos enable row level security;

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

-- An upsert is `INSERT ... ON CONFLICT DO UPDATE`, and the DO UPDATE half is
-- checked against the UPDATE policy. Without one, saving an already-saved
-- video failed with "new row violates row-level security policy (USING
-- expression)". The row has no mutable columns, but the policy keeps upserts
-- working for any client that still uses them.
drop policy if exists "Users update their own saved full videos" on public.saved_full_videos;
create policy "Users update their own saved full videos"
  on public.saved_full_videos for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
