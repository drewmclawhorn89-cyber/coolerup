-- Story likes: heart a story the same way you heart a video.
create table if not exists public.story_likes (
  id uuid primary key default gen_random_uuid(),
  story_id uuid not null references public.stories(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint story_likes_story_id_user_id_key unique (story_id, user_id)
);

create index if not exists story_likes_story_idx on public.story_likes (story_id);
create index if not exists story_likes_user_idx on public.story_likes (user_id, created_at desc);

alter table public.story_likes enable row level security;

drop policy if exists "Story likes are public" on public.story_likes;
create policy "Story likes are public"
  on public.story_likes for select
  using (true);

drop policy if exists "Users like stories for themselves" on public.story_likes;
create policy "Users like stories for themselves"
  on public.story_likes for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users remove their own story likes" on public.story_likes;
create policy "Users remove their own story likes"
  on public.story_likes for delete
  to authenticated
  using (auth.uid() = user_id);

-- Denormalized counter so the viewer can show a count without an extra query.
alter table public.stories
  add column if not exists likes_count integer not null default 0;

create or replace function public.bump_story_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    update public.stories
       set likes_count = likes_count + 1
     where id = new.story_id;
  elsif tg_op = 'DELETE' then
    update public.stories
       set likes_count = greatest(likes_count - 1, 0)
     where id = old.story_id;
  end if;
  return null;
end;
$$;

drop trigger if exists story_likes_count_trigger on public.story_likes;
create trigger story_likes_count_trigger
  after insert or delete on public.story_likes
  for each row execute function public.bump_story_like_count();

-- Backfill for re-runs.
update public.stories s
   set likes_count = (
     select count(*) from public.story_likes l where l.story_id = s.id
   );

notify pgrst, 'reload schema';
