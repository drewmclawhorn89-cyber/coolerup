-- Minimal harness so 0030 can be executed and tested without Supabase.
drop schema if exists public cascade;
drop schema if exists auth cascade;
create schema auth;
create schema public;

create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  confirmation_token text,
  recovery_token text,
  email_change_token_new text,
  email_change text
);
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
create type public.app_role as enum ('user','moderator','admin');
create table public.user_roles (user_id uuid, role public.app_role, unique (user_id, role));
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
language sql stable as $$ select exists (select 1 from public.user_roles where user_id = _uid and role = _role::public.app_role) $$;

create or replace function public.is_owner_uid(_uid uuid) returns boolean
language sql stable as $$ select _uid = '11111111-1111-4111-8111-111111111111'::uuid $$;

create or replace function public.safety_bot_uid() returns uuid
language sql immutable as $$ select '00000000-0000-4000-8000-0000000005af'::uuid $$;

alter table public.videos enable row level security;
alter table public.comments enable row level security;
create policy "read videos" on public.videos for select to anon, authenticated using (true);
create policy "read comments" on public.comments for select to anon, authenticated using (true);

-- Extra tables the full all-in-one script expects on a real Coolerup DB.
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid,
  reporter_username text,
  reported_username text,
  reported_user_id uuid,
  reported_video_id uuid,
  video_id uuid,
  reason text,
  details text,
  status text default 'open',
  created_at timestamptz default now()
);
create table if not exists public.banned_users (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  username text,
  reason text,
  banned_by text,
  is_permanent boolean default true,
  expires_at timestamptz,
  created_at timestamptz default now()
);
create or replace function public.norm_handle(_h text) returns text
language sql immutable as $$ select lower(btrim(coalesce(_h, ''))) $$;
