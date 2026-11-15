-- Comments on posts inside Groups (public and private).

create table if not exists public.group_post_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.group_posts (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  username text not null,
  body text not null default '',
  gif_url text,
  gif_credit text,
  created_at timestamptz not null default now(),
  constraint group_post_comments_non_empty check (
    char_length(trim(body)) > 0 or gif_url is not null
  )
);

create index if not exists group_post_comments_post_idx
  on public.group_post_comments (post_id, created_at asc);

alter table public.group_post_comments enable row level security;

drop policy if exists "group post comments readable" on public.group_post_comments;
create policy "group post comments readable"
  on public.group_post_comments
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.group_posts gp
      join public.groups g on g.id = gp.group_id
      where gp.id = group_post_comments.post_id
        and (
          g.privacy = 'public'
          or exists (
            select 1
            from public.group_members m
            where m.group_id = g.id
              and m.user_id = auth.uid()
              and m.role in ('admin', 'moderator', 'member')
          )
        )
    )
  );

drop policy if exists "members comment on group posts" on public.group_post_comments;
create policy "members comment on group posts"
  on public.group_post_comments
  for insert
  to authenticated
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.group_posts gp
      join public.group_members m on m.group_id = gp.group_id
      where gp.id = group_post_comments.post_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator', 'member')
    )
  );

drop policy if exists "authors and staff delete group comments" on public.group_post_comments;
create policy "authors and staff delete group comments"
  on public.group_post_comments
  for delete
  to authenticated
  using (
    auth.uid() = user_id
    or exists (
      select 1
      from public.group_posts gp
      join public.group_members m on m.group_id = gp.group_id
      where gp.id = group_post_comments.post_id
        and m.user_id = auth.uid()
        and m.role in ('admin', 'moderator')
    )
  );

notify pgrst, 'reload schema';
