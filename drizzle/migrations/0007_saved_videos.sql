create table if not exists public.saved_videos (
  user_id uuid not null references auth.users(id) on delete cascade,
  video_id uuid not null references public.videos(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, video_id)
);

alter table public.saved_videos enable row level security;

create policy "Saved videos are public" on public.saved_videos for select using (true);
create policy "Users save for themselves" on public.saved_videos for insert to authenticated with check (auth.uid() = user_id);
create policy "Users unsave their own" on public.saved_videos for delete to authenticated using (auth.uid() = user_id);
