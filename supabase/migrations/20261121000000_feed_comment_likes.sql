-- Likes for the For You feed's comments.
--
-- `comments` (the short-clip feed) predates user accounts and only stores a
-- `username`, so the like row carries the `user_id` instead. One like per
-- person per comment, enforced by the unique constraint.

create table if not exists public.comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (comment_id, user_id)
);

create index if not exists comment_likes_comment_id_idx
  on public.comment_likes (comment_id);

create index if not exists comment_likes_user_id_idx
  on public.comment_likes (user_id);

alter table public.comment_likes enable row level security;

-- Counts are public so signed-out visitors still see the number.
drop policy if exists "comment likes are viewable by everyone" on public.comment_likes;
create policy "comment likes are viewable by everyone"
  on public.comment_likes for select
  using (true);

drop policy if exists "users manage their own comment likes" on public.comment_likes;
create policy "users manage their own comment likes"
  on public.comment_likes for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
