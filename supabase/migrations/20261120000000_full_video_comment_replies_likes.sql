-- Replies and likes for full-length video comments.
--
-- The feed's short-clip comments already support one level of replies
-- (`comments.parent_id`) and the Videos tab should behave the same way: a
-- reply is stored as a comment with `parent_id` pointing at a top-level
-- comment. Replies to a reply are flattened onto the same parent so the
-- thread never nests deeper than one level.

alter table public.full_video_comments
  add column if not exists parent_id uuid
  references public.full_video_comments (id) on delete cascade;

create index if not exists full_video_comments_parent_id_idx
  on public.full_video_comments (parent_id);

-- A reply must live on the same video as the comment it answers. Without this
-- a client could point a reply at a comment on a different video and the
-- thread would render in the wrong place.
create or replace function public.full_video_comment_same_video()
returns trigger
language plpgsql
as $$
declare
  parent_video uuid;
begin
  if new.parent_id is null then
    return new;
  end if;

  select video_id into parent_video
  from public.full_video_comments
  where id = new.parent_id;

  if parent_video is null then
    raise exception 'Parent comment does not exist';
  end if;

  if parent_video <> new.video_id then
    raise exception 'Reply must belong to the same video as its parent';
  end if;

  return new;
end;
$$;

drop trigger if exists full_video_comment_same_video_trg on public.full_video_comments;
create trigger full_video_comment_same_video_trg
  before insert or update of parent_id, video_id on public.full_video_comments
  for each row execute function public.full_video_comment_same_video();

-- ---------------------------------------------------------------------------
-- Comment likes
-- ---------------------------------------------------------------------------

create table if not exists public.full_video_comment_likes (
  id uuid primary key default gen_random_uuid(),
  comment_id uuid not null references public.full_video_comments (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- One like per person per comment.
  unique (comment_id, user_id)
);

create index if not exists full_video_comment_likes_comment_id_idx
  on public.full_video_comment_likes (comment_id);

alter table public.full_video_comment_likes enable row level security;

-- Counts are public so signed-out visitors still see the number.
drop policy if exists "full video comment likes are viewable by everyone"
  on public.full_video_comment_likes;
create policy "full video comment likes are viewable by everyone"
  on public.full_video_comment_likes for select
  using (true);

drop policy if exists "users manage their own full video comment likes"
  on public.full_video_comment_likes;
create policy "users manage their own full video comment likes"
  on public.full_video_comment_likes for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
