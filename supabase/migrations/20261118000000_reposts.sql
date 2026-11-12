-- Reposts: one row per (user, video). Powers the 🔁 button on the video card,
-- the "@username reposted" label in the Following feed and the Reposts tab on
-- profiles. The table already exists in production; everything here is
-- idempotent so it can be pasted into the SQL editor safely.

create extension if not exists pgcrypto;

create table if not exists public.reposts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  video_id uuid not null references public.videos (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint reposts_user_id_video_id_key unique (user_id, video_id)
);

create index if not exists reposts_user_created_idx
  on public.reposts (user_id, created_at desc);
create index if not exists reposts_video_idx on public.reposts (video_id);

alter table public.reposts enable row level security;

-- Anyone can see reposts (the Following feed reads other people's rows).
drop policy if exists "Reposts are public" on public.reposts;
create policy "Reposts are public"
  on public.reposts for select
  using (true);

-- You can only create/delete your own repost.
drop policy if exists "Users can repost as themselves" on public.reposts;
create policy "Users can repost as themselves"
  on public.reposts for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can remove their own repost" on public.reposts;
create policy "Users can remove their own repost"
  on public.reposts for delete
  to authenticated
  using (auth.uid() = user_id);

-- Keep videos.reposts_count in sync so the rail label survives a reload.
alter table public.videos add column if not exists reposts_count integer not null default 0;

create or replace function public.sync_reposts_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'INSERT') then
    update public.videos
      set reposts_count = coalesce(reposts_count, 0) + 1
      where id = new.video_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.videos
      set reposts_count = greatest(coalesce(reposts_count, 0) - 1, 0)
      where id = old.video_id;
    return old;
  end if;
  return null;
end;
$$;

drop trigger if exists reposts_count_sync on public.reposts;
create trigger reposts_count_sync
  after insert or delete on public.reposts
  for each row execute function public.sync_reposts_count();

notify pgrst, 'reload schema';
