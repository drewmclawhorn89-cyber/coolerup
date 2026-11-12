-- ===========================================================================
-- Coolerup — "Make Your Own GIFs" (TikTok style)
-- Paste this whole file into Supabase → SQL Editor → Run.
-- Safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The gifs table
-- ---------------------------------------------------------------------------
create table if not exists public.gifs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  gif_url text not null,
  title text not null default 'Untitled GIF',
  is_public boolean not null default true,
  -- Where the clip came from. Null for a fresh recording / phone upload.
  -- Deliberately NOT a foreign key: the `videos` table is managed outside
  -- these migrations, and a missing FK target would abort the whole script.
  source_video_id uuid,
  -- Cheap "Trending" signal: bumped every time someone picks the GIF.
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists gifs_public_created_idx
  on public.gifs (is_public, created_at desc);
create index if not exists gifs_user_created_idx
  on public.gifs (user_id, created_at desc);

alter table public.gifs enable row level security;

drop policy if exists "public gifs are viewable by everyone" on public.gifs;
create policy "public gifs are viewable by everyone"
  on public.gifs for select
  to anon, authenticated
  using (is_public or user_id = auth.uid());

drop policy if exists "users create their own gifs" on public.gifs;
create policy "users create their own gifs"
  on public.gifs for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users update their own gifs" on public.gifs;
create policy "users update their own gifs"
  on public.gifs for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "users delete their own gifs" on public.gifs;
create policy "users delete their own gifs"
  on public.gifs for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 2. Reports ("if a GIF is stolen, you can report it")
-- ---------------------------------------------------------------------------
create table if not exists public.gif_reports (
  id uuid primary key default gen_random_uuid(),
  gif_id uuid not null references public.gifs (id) on delete cascade,
  reporter_id uuid references public.profiles (id) on delete set null,
  reason text not null default 'stolen',
  created_at timestamptz not null default now()
);

create index if not exists gif_reports_gif_idx
  on public.gif_reports (gif_id, created_at desc);

alter table public.gif_reports enable row level security;

drop policy if exists "users create gif reports" on public.gif_reports;
create policy "users create gif reports"
  on public.gif_reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "users see their own gif reports" on public.gif_reports;
create policy "users see their own gif reports"
  on public.gif_reports for select
  to authenticated
  using (reporter_id = auth.uid());

-- ---------------------------------------------------------------------------
-- 3. Public storage bucket: 5 MB per GIF, GIFs only
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gifs', 'gifs', true, 5242880, array['image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 5242880,
      allowed_mime_types = array['image/gif'];

drop policy if exists "public read gifs bucket" on storage.objects;
create policy "public read gifs bucket"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'gifs');

-- Objects live under `{user_id}/...`, so a user can only write in their folder.
drop policy if exists "users upload their own gifs" on storage.objects;
create policy "users upload their own gifs"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'gifs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "users delete their own gif objects" on storage.objects;
create policy "users delete their own gif objects"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'gifs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 4. "Made by @handle" credit columns
--    This is the one that fixes "column comments.gif_credit does not exist".
-- ---------------------------------------------------------------------------
alter table public.comments
  add column if not exists gif_credit text;

alter table public.full_video_comments
  add column if not exists gif_credit text;

alter table public.direct_messages
  add column if not exists gif_url text;

alter table public.direct_messages
  add column if not exists gif_credit text;

-- ---------------------------------------------------------------------------
-- 5. Trending counter
--    A plain UPDATE only works for the owner (RLS), so this runs as definer
--    and touches exactly one counter.
-- ---------------------------------------------------------------------------
create or replace function public.increment_gif_use(p_gif_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.gifs
     set use_count = use_count + 1
   where id = p_gif_id
     and is_public;
$$;

grant execute on function public.increment_gif_use(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Tell PostgREST to pick up the new columns immediately
-- ---------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- ---------------------------------------------------------------------------
-- 7. Verification — should return exactly 4 rows
-- ---------------------------------------------------------------------------
select table_name, column_name
from information_schema.columns
where (table_name = 'comments' and column_name = 'gif_credit')
   or (table_name = 'full_video_comments' and column_name = 'gif_credit')
   or (table_name = 'direct_messages' and column_name in ('gif_url', 'gif_credit'))
order by table_name, column_name;
