-- Minimal harness so 0030 can be executed and tested without Supabase.
drop schema if exists public cascade;
drop schema if exists auth cascade;
create schema auth;
create schema public;

create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create table public.user_roles (user_id uuid, role text);
create table public.profiles (
  id uuid primary key,
  handle text,
  display_name text,
  bio text,
  avatar_url text
);
create table public.videos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  username text,
  caption text,
  video_url text,
  hidden boolean not null default false,
  hidden_reason text,
  source_id uuid,
  source_url text,
  is_tiktok boolean default false,
  created_at timestamptz default now()
);
create table public.comments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid,
  username text,
  body text,
  created_at timestamptz default now()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid,
  receiver_id uuid,
  message text
);
create table public.moderation_log (
  id uuid primary key default gen_random_uuid(),
  action text,
  actor text,
  actor_id uuid,
  auto boolean,
  reason text,
  username text,
  user_id uuid,
  kind text,
  content_type text,
  content_id uuid,
  content_excerpt text,
  strike_count integer,
  is_permanent boolean,
  created_at timestamptz default now()
);

create or replace function public.has_role(_uid uuid, _role text) returns boolean
language sql stable as $$ select exists (select 1 from public.user_roles where user_id = _uid and role = _role) $$;

create or replace function public.is_owner_uid(_uid uuid) returns boolean
language sql stable as $$ select _uid = '11111111-1111-4111-8111-111111111111'::uuid $$;

create or replace function public.safety_bot_uid() returns uuid
language sql immutable as $$ select '00000000-0000-4000-8000-0000000005af'::uuid $$;

alter table public.videos enable row level security;
alter table public.comments enable row level security;
create policy "read videos" on public.videos for select to anon, authenticated using (true);
create policy "read comments" on public.comments for select to anon, authenticated using (true);
