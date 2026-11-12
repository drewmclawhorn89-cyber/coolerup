-- Groups: Facebook-style group pages with members, roles and a group feed.
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  description text,
  cover_image text,
  avatar_image text,
  privacy text not null default 'public' check (privacy in ('public', 'private')),
  creator_id uuid not null references auth.users(id) on delete cascade,
  creator_username text,
  created_at timestamptz not null default now(),
  members_count integer not null default 0
);

create index if not exists groups_created_idx on public.groups (created_at desc);
create index if not exists groups_name_idx on public.groups (lower(name));

create table if not exists public.group_members (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  role text not null default 'member' check (role in ('admin', 'moderator', 'member')),
  joined_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists group_members_group_idx on public.group_members (group_id, joined_at);
create index if not exists group_members_user_idx on public.group_members (user_id);

create table if not exists public.group_posts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  caption text,
  video_url text,
  image_url text,
  created_at timestamptz not null default now(),
  likes integer not null default 0
);

create index if not exists group_posts_group_idx on public.group_posts (group_id, created_at desc);

-- Private groups need admin approval before a member is added.
create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  unique (group_id, user_id)
);

create index if not exists group_join_requests_group_idx on public.group_join_requests (group_id, status);

alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_posts enable row level security;
alter table public.group_join_requests enable row level security;

-- Helper: is the current user an admin/moderator of this group?
create or replace function public.is_group_staff(gid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid() and m.role in ('admin', 'moderator')
  );
$$;

create or replace function public.is_group_member(gid uuid) returns boolean
language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.group_members m
    where m.group_id = gid and m.user_id = auth.uid()
  );
$$;

drop policy if exists "Groups are public" on public.groups;
create policy "Groups are public" on public.groups for select using (true);
drop policy if exists "Users create groups" on public.groups;
create policy "Users create groups" on public.groups for insert to authenticated with check (auth.uid() = creator_id);
drop policy if exists "Admins update groups" on public.groups;
create policy "Admins update groups" on public.groups for update to authenticated
  using (auth.uid() = creator_id or public.is_group_staff(id))
  with check (auth.uid() = creator_id or public.is_group_staff(id));
drop policy if exists "Creator deletes group" on public.groups;
create policy "Creator deletes group" on public.groups for delete to authenticated using (auth.uid() = creator_id);

drop policy if exists "Members are public" on public.group_members;
create policy "Members are public" on public.group_members for select using (true);
drop policy if exists "Users join groups" on public.group_members;
create policy "Users join groups" on public.group_members for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "Members leave groups" on public.group_members;
create policy "Members leave groups" on public.group_members for delete to authenticated
  using (auth.uid() = user_id or public.is_group_staff(group_id));
drop policy if exists "Staff update roles" on public.group_members;
create policy "Staff update roles" on public.group_members for update to authenticated
  using (public.is_group_staff(group_id)) with check (public.is_group_staff(group_id));

drop policy if exists "Group posts are public" on public.group_posts;
create policy "Group posts are public" on public.group_posts for select using (true);
drop policy if exists "Members post in groups" on public.group_posts;
create policy "Members post in groups" on public.group_posts for insert to authenticated
  with check (auth.uid() = user_id and public.is_group_member(group_id));
drop policy if exists "Authors and staff delete posts" on public.group_posts;
create policy "Authors and staff delete posts" on public.group_posts for delete to authenticated
  using (auth.uid() = user_id or public.is_group_staff(group_id));
drop policy if exists "Anyone can like group posts" on public.group_posts;
create policy "Anyone can like group posts" on public.group_posts for update to authenticated using (true) with check (true);

drop policy if exists "Users see own join requests" on public.group_join_requests;
create policy "Users see own join requests" on public.group_join_requests for select to authenticated
  using (auth.uid() = user_id or public.is_group_staff(group_id));
drop policy if exists "Users request to join" on public.group_join_requests;
create policy "Users request to join" on public.group_join_requests for insert to authenticated
  with check (auth.uid() = user_id);
drop policy if exists "Staff manage join requests" on public.group_join_requests;
create policy "Staff manage join requests" on public.group_join_requests for update to authenticated
  using (public.is_group_staff(group_id)) with check (public.is_group_staff(group_id));
drop policy if exists "Users cancel join requests" on public.group_join_requests;
create policy "Users cancel join requests" on public.group_join_requests for delete to authenticated
  using (auth.uid() = user_id or public.is_group_staff(group_id));

-- Keep groups.members_count in sync with group_members.
create or replace function public.bump_group_members_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.groups set members_count = members_count + 1 where id = new.group_id;
  elsif tg_op = 'DELETE' then
    update public.groups set members_count = greatest(members_count - 1, 0) where id = old.group_id;
  end if;
  return null;
end;
$$;

drop trigger if exists group_members_count_trigger on public.group_members;
create trigger group_members_count_trigger
  after insert or delete on public.group_members
  for each row execute function public.bump_group_members_count();

-- Backfill in case the tables already had rows.
update public.groups g
set members_count = (select count(*) from public.group_members m where m.group_id = g.id);

-- Storage bucket for group covers and avatars.
insert into storage.buckets (id, name, public) values ('groups', 'groups', true) on conflict (id) do nothing;

drop policy if exists "groups upload own folder" on storage.objects;
create policy "groups upload own folder" on storage.objects for insert to authenticated
  with check (bucket_id = 'groups' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "groups read" on storage.objects;
create policy "groups read" on storage.objects for select using (bucket_id = 'groups');
