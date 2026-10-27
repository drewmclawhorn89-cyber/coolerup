create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  media_url text not null,
  media_type text not null default 'image',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

create index if not exists stories_username_idx on public.stories (username, created_at);

alter table public.stories enable row level security;

create policy "Stories are public until expired" on public.stories for select using (expires_at > now());
create policy "Users post their own stories" on public.stories for insert to authenticated with check (auth.uid() = user_id);
create policy "Users delete their own stories" on public.stories for delete to authenticated using (auth.uid() = user_id);
