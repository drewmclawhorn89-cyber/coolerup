-- Facebook-style Groups
--
-- The three tables below already exist in the Coolerup project. This migration
-- is written to be idempotent so it can be re-run safely (and so a fresh
-- environment gets the same shape + RLS policies).
--
-- group_members.role is a free-text column. Values used by the app:
--   admin | moderator | member | pending | banned
-- "pending" = a join request waiting for an admin (private groups),
-- "banned"  = blocked from the group, kept for the admin's banned list.

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  cover_image text,
  avatar_image text,
  privacy text not null default 'public' check (privacy in ('public', 'private')),
  creator_id uuid not null references auth.users (id) on delete cascade,
  creator_username text not null,
  created_at timestamptz not null default now(),
  members_count integer not null default 1
);

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  role text not null default 'member' check (role in ('admin', 'moderator', 'member', 'pending', 'banned')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create table if not exists public.group_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  caption text,
  video_url text,
  image_url text,
  created_at timestamptz not null default now(),
  likes integer not null default 0
);

create index if not exists groups_created_at_idx on public.groups (created_at desc);
create index if not exists group_members_group_idx on public.group_members (group_id);
create index if not exists group_members_user_idx on public.group_members (user_id);
create index if not exists group_posts_group_idx on public.group_posts (group_id, created_at desc);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_posts enable row level security;

-- Groups: everyone can read, signed-in users can create, the creator (or an
-- admin member) can update/delete.
drop policy if exists "groups are public" on public.groups;
create policy "groups are public" on public.groups for select using (true);

drop policy if exists "signed in users create groups" on public.groups;
create policy "signed in users create groups" on public.groups for insert
  with check (auth.uid() = creator_id);

drop policy if exists "creator updates group" on public.groups;
create policy "creator updates group" on public.groups for update
  using (
    auth.uid() = creator_id
    or exists (
      select 1 from public.group_members m
      where m.group_id = groups.id and m.user_id = auth.uid() and m.role = 'admin'
    )
  );

drop policy if exists "creator deletes group" on public.groups;
create policy "creator deletes group" on public.groups for delete using (auth.uid() = creator_id);

-- Members: readable by everyone (member lists), users manage their own row,
-- admins can manage every row in their group.
drop policy if exists "group members are public" on public.group_members;
create policy "group members are public" on public.group_members for select using (true);

drop policy if exists "users join groups" on public.group_members;
create policy "users join groups" on public.group_members for insert with check (auth.uid() = user_id);

drop policy if exists "users leave or admins manage members" on public.group_members;
create policy "users leave or admins manage members" on public.group_members for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.group_members m
      where m.group_id = group_members.group_id and m.user_id = auth.uid() and m.role in ('admin', 'moderator')
    )
  );

drop policy if exists "admins update members" on public.group_members;
create policy "admins update members" on public.group_members for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.group_members m
      where m.group_id = group_members.group_id and m.user_id = auth.uid() and m.role in ('admin', 'moderator')
    )
  );

-- Posts: readable by everyone, members post, authors/admins delete.
drop policy if exists "group posts are public" on public.group_posts;
create policy "group posts are public" on public.group_posts for select using (true);

drop policy if exists "members create group posts" on public.group_posts;
create policy "members create group posts" on public.group_posts for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1 from public.group_members m
      where m.group_id = group_posts.group_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator', 'member')
    )
  );

drop policy if exists "authors and admins update group posts" on public.group_posts;
create policy "authors and admins update group posts" on public.group_posts for update
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.group_members m
      where m.group_id = group_posts.group_id and m.user_id = auth.uid() and m.role in ('admin', 'moderator')
    )
  );

drop policy if exists "authors and admins delete group posts" on public.group_posts;
create policy "authors and admins delete group posts" on public.group_posts for delete
  using (
    auth.uid() = user_id
    or exists (
      select 1 from public.group_members m
      where m.group_id = group_posts.group_id and m.user_id = auth.uid() and m.role in ('admin', 'moderator')
    )
  );

-- Group cover/avatar/post media reuse the existing public "videos" bucket under
-- a groups/ prefix, so no extra bucket is required.
