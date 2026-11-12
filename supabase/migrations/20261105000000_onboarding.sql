-- Onboarding: username, birthday, display name, bio, completion flag.
--
-- IMPORTANT: this migration is strictly additive. It never drops or rewrites
-- existing rows, so every existing video, like, comment and follower stays
-- linked to the same user_id. Existing accounts simply get NULL for the new
-- profile fields and onboarding_complete = false until they fill them in.

alter table public.profiles
  add column if not exists username text,
  add column if not exists birthday date,
  add column if not exists display_name text,
  add column if not exists bio text,
  add column if not exists onboarding_complete boolean not null default false;

-- Usernames are unique when present, but nullable so old accounts (which only
-- have `handle`) are untouched. Case-insensitive to avoid Drew/drew clashes.
create unique index if not exists profiles_username_lower_key
  on public.profiles (lower(username))
  where username is not null;

-- Reserved usernames cannot be claimed by anyone. The app also hard-codes this
-- list as a fallback, but keeping it in the DB makes the rule authoritative.
create table if not exists public.reserved_usernames (
  username text primary key,
  reason text
);

insert into public.reserved_usernames (username, reason)
values
  ('drewmclawhorn3', 'Owner handle'),
  ('coolerup', 'App name'),
  ('admin', 'Reserved'),
  ('support', 'Reserved')
on conflict (username) do nothing;

alter table public.reserved_usernames enable row level security;

drop policy if exists "reserved usernames are readable by everyone" on public.reserved_usernames;
create policy "reserved usernames are readable by everyone"
  on public.reserved_usernames for select
  using (true);

-- Backfill nothing: existing users keep username = NULL and onboarding_complete
-- = false, which is exactly what triggers the "Complete profile" banner. Their
-- videos and likes are not touched.

-- Helpful for the onboarding lookup by id (already covered by PK, but the
-- partial index above keeps username availability checks fast).
create index if not exists profiles_onboarding_complete_idx
  on public.profiles (onboarding_complete);
