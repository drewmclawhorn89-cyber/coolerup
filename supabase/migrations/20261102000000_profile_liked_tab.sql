-- Profile "Liked" tab (TikTok-style).
--
-- * `profiles.show_liked` lets a user hide the videos they liked.
-- * `likes` gets an index so "videos this user liked, newest first" is cheap.
-- * Permissive RLS so likes can be read (counts + liked tab) while writes stay
--   restricted to the signed-in owner of the like.

alter table public.profiles
  add column if not exists show_liked boolean not null default true;

create index if not exists likes_user_created_idx
  on public.likes (user_id, created_at desc);

create index if not exists likes_video_idx
  on public.likes (video_id);

-- One like per person per video. Wrapped so pre-existing duplicate rows don't
-- abort the migration.
do $$
begin
  create unique index if not exists likes_user_video_key
    on public.likes (user_id, video_id);
exception
  when others then
    raise notice 'Skipped likes_user_video_key: %', sqlerrm;
end $$;

alter table public.likes enable row level security;

drop policy if exists "likes are readable by everyone" on public.likes;
create policy "likes are readable by everyone"
  on public.likes for select
  using (true);

drop policy if exists "users can like as themselves" on public.likes;
create policy "users can like as themselves"
  on public.likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can remove their own likes" on public.likes;
create policy "users can remove their own likes"
  on public.likes for delete
  to authenticated
  using (auth.uid() = user_id);
