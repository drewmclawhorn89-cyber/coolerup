-- User-made GIFs ("Make Your Own GIFs", TikTok style).
--
-- Every GIF is cut from a video the signed-in user owns, converted in the
-- browser with ffmpeg.wasm, and stored as a real .gif in the public `gifs`
-- bucket. Rows are tiny (a URL + title), so the feed stays light; the 5 MB
-- object cap below is what stops a single GIF from bloating the app.
--
-- `source_video_id` is deliberately nullable: recordings and phone uploads
-- have no row in `videos`, but when a GIF *is* cut from a Coolerup video we
-- keep the link so ownership can be audited (and the GIF removed if the
-- source is deleted).

create table if not exists public.gifs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  gif_url text not null,
  title text not null default 'Untitled GIF',
  is_public boolean not null default true,
  -- Where the clip came from. Null for a fresh recording / phone upload.
  source_video_id uuid references public.videos (id) on delete set null,
  -- Cheap "Trending" signal: bumped every time someone picks the GIF.
  use_count integer not null default 0,
  created_at timestamptz not null default now()
);

-- The picker's two lists: "Trending" (public, newest/most used) and
-- "My GIFs" (by user). Both are served by these indexes.
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
-- Reports: "if a GIF is stolen, you can report it". Owners can always delete
-- their own GIF above; reports give everyone else a way to flag a copy.
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
-- Public storage bucket. Hard 5 MB per GIF and GIF-only mime types keep the
-- app small — a 3 second 480px GIF lands far below this.
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

-- Objects live under `{user_id}/...`, so a signed-in user can only write
-- into their own folder.
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
-- Credit line ("Made by @handle") travels with the comment so a GIF keeps its
-- author even when the picker is long gone. Nullable: Giphy GIFs have no
-- Coolerup author.
-- ---------------------------------------------------------------------------
alter table public.comments
  add column if not exists gif_credit text;

alter table public.full_video_comments
  add column if not exists gif_credit text;

notify pgrst, 'reload schema';

-- Bump "Trending" when someone picks a GIF. A plain UPDATE would only work for
-- the owner (RLS), so this runs as definer and touches exactly one counter.
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

-- DMs can carry a GIF too. `message` stays NOT NULL, so a GIF-only DM stores
-- an empty string and the UI renders the image instead of text.
alter table public.direct_messages
  add column if not exists gif_url text;
alter table public.direct_messages
  add column if not exists gif_credit text;

notify pgrst, 'reload schema';
