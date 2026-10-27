-- Reposts: a user sharing someone else's video to their own followers (TikTok-style).
create table if not exists public.reposts (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null references public.videos(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (video_id, user_id)
);

create index if not exists reposts_user_idx on public.reposts (user_id, created_at desc);
create index if not exists reposts_video_idx on public.reposts (video_id);

alter table public.reposts enable row level security;

-- Reposts are public so profiles and follower feeds can read them.
create policy "Reposts are public" on public.reposts for select using (true);
create policy "Users repost for themselves" on public.reposts for insert to authenticated with check (auth.uid() = user_id);
create policy "Users remove their own reposts" on public.reposts for delete to authenticated using (auth.uid() = user_id);

-- Denormalized counter on videos so feeds can show the count without an N+1 query.
alter table public.videos add column if not exists reposts_count integer not null default 0;

create or replace function public.bump_repost_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.videos set reposts_count = reposts_count + 1 where id = new.video_id;
  elsif tg_op = 'DELETE' then
    update public.videos set reposts_count = greatest(reposts_count - 1, 0) where id = old.video_id;
  end if;
  return null;
end;
$$;

drop trigger if exists reposts_count_trigger on public.reposts;
create trigger reposts_count_trigger
  after insert or delete on public.reposts
  for each row execute function public.bump_repost_count();

-- Backfill in case the table already had rows when this migration is re-run.
update public.videos v
set reposts_count = (select count(*) from public.reposts r where r.video_id = v.id);
