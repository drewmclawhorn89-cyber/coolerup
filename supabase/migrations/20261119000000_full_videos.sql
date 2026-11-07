-- YouTube-style full-length videos.
--
-- Short vertical clips live in `videos` (the TikTok-style feed). Long-form,
-- horizontal 16:9 uploads live here instead so the two experiences can evolve
-- independently: different player, different layout, different limits.

create table if not exists public.full_videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  title text not null,
  description text not null default '',
  video_url text not null,
  thumbnail_url text,
  -- Duration in whole seconds. 60 min cap is enforced in the UI and here.
  duration integer not null default 0 check (duration >= 0 and duration <= 3600),
  views bigint not null default 0,
  category text not null default 'All',
  tags text[] not null default '{}',
  -- Optional per-rendition URLs; all null until transcoding exists.
  video_1080_url text,
  video_720_url text,
  video_480_url text,
  created_at timestamptz not null default now()
);

create index if not exists full_videos_created_at_idx on public.full_videos (created_at desc);
create index if not exists full_videos_category_idx on public.full_videos (category);
create index if not exists full_videos_user_id_idx on public.full_videos (user_id);

alter table public.full_videos enable row level security;

-- Anyone (including signed-out visitors) can watch.
drop policy if exists "full_videos are viewable by everyone" on public.full_videos;
create policy "full_videos are viewable by everyone"
  on public.full_videos for select
  using (true);

drop policy if exists "users can upload their own full videos" on public.full_videos;
create policy "users can upload their own full videos"
  on public.full_videos for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own full videos" on public.full_videos;
create policy "users can update their own full videos"
  on public.full_videos for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own full videos" on public.full_videos;
create policy "users can delete their own full videos"
  on public.full_videos for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------------

-- Bumping the counter needs to work for signed-out viewers too, but a plain
-- UPDATE policy would let anyone rewrite the row. A SECURITY DEFINER function
-- that only touches `views` is the safe middle ground.
create or replace function public.increment_full_video_views(video_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.full_videos
     set views = views + 1
   where id = video_id;
$$;

grant execute on function public.increment_full_video_views(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Likes / dislikes
-- ---------------------------------------------------------------------------

create table if not exists public.full_video_likes (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.full_videos (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- One reaction per person per video; 'dislike' rows are kept so the UI can
  -- show which of the two buttons is active.
  reaction text not null check (reaction in ('like', 'dislike')),
  created_at timestamptz not null default now(),
  unique (video_id, user_id)
);

create index if not exists full_video_likes_video_id_idx on public.full_video_likes (video_id);

alter table public.full_video_likes enable row level security;

drop policy if exists "full video likes are viewable by everyone" on public.full_video_likes;
create policy "full video likes are viewable by everyone"
  on public.full_video_likes for select
  using (true);

drop policy if exists "users manage their own full video likes" on public.full_video_likes;
create policy "users manage their own full video likes"
  on public.full_video_likes for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Comments (YouTube-style: a list below the player, not an overlay)
-- ---------------------------------------------------------------------------

create table if not exists public.full_video_comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.full_videos (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  username text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists full_video_comments_video_id_idx
  on public.full_video_comments (video_id, created_at desc);

alter table public.full_video_comments enable row level security;

drop policy if exists "full video comments are viewable by everyone" on public.full_video_comments;
create policy "full video comments are viewable by everyone"
  on public.full_video_comments for select
  using (true);

drop policy if exists "signed-in users can comment on full videos" on public.full_video_comments;
create policy "signed-in users can comment on full videos"
  on public.full_video_comments for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can delete their own full video comments" on public.full_video_comments;
create policy "users can delete their own full video comments"
  on public.full_video_comments for delete
  to authenticated
  using (auth.uid() = user_id);
