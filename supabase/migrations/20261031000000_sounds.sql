-- "Use this sound" (TikTok-style original sounds)
--
-- Every uploaded video automatically gets an "Original sound" row. Other
-- creators can attach that sound to their own video, which bumps uses_count.
--
-- Copyright-safe by design: a sound is always the audio track of a real user
-- video (audio_url points at the source video file). No commercial catalogue.

create table if not exists public.sounds (
  id uuid primary key default gen_random_uuid(),
  original_video_id uuid not null references public.videos (id) on delete cascade,
  audio_url text not null,
  title text not null,
  creator_username text not null,
  uses_count integer not null default 1,
  created_at timestamptz not null default now(),
  constraint sounds_original_video_id_key unique (original_video_id)
);

-- The feed queries "videos using this sound", so keep that lookup fast.
create index if not exists sounds_uses_count_idx on public.sounds (uses_count desc, created_at desc);
create index if not exists sounds_creator_idx on public.sounds (creator_username);
create index if not exists sounds_created_at_idx on public.sounds (created_at desc);

-- Link videos to the sound they play. `on delete set null` keeps a video
-- playable if its sound row is ever removed.
alter table public.videos add column if not exists sound_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'videos_sound_id_fkey'
      and conrelid = 'public.videos'::regclass
  ) then
    alter table public.videos
      add constraint videos_sound_id_fkey
      foreign key (sound_id) references public.sounds (id) on delete set null;
  end if;
end $$;

create index if not exists videos_sound_id_idx on public.videos (sound_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Build a human title from a caption. Strips the internal [[song:...]] and
-- [[full]] markers the app appends to captions.
create or replace function public.sound_title_for_video(_caption text, _username text)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(
      btrim(regexp_replace(coalesce(_caption, ''), '\s*\[\[(song:[^\]]*|full)\]\]\s*', '', 'gi')),
      ''
    ),
    'Original sound - @' || coalesce(_username, 'creator')
  );
$$;

-- Create (or refresh) the sound that belongs to a video, then point the video
-- at it. Safe to call more than once: original_video_id is unique.
create or replace function public.create_sound_from_video(_video_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.videos%rowtype;
  s_id uuid;
  t text;
begin
  select * into v from public.videos where id = _video_id;
  if not found then
    return null;
  end if;

  -- Photos have no audio track.
  if v.video_url ~* '\.(jpe?g|png|webp|gif|avif)(\?|#|$)' then
    return null;
  end if;

  -- Only the owner (or a trusted server call) may create the sound.
  if auth.uid() is not null
     and v.user_id is distinct from auth.uid()
     and not exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.handle = v.username
     ) then
    raise exception 'not your video';
  end if;

  t := public.sound_title_for_video(v.caption, v.username);

  -- If the video already borrowed someone else's sound, its own original sound
  -- exists but has zero uses (nobody is playing it yet).
  insert into public.sounds (original_video_id, audio_url, title, creator_username, uses_count)
  values (v.id, v.video_url, left(t, 140), v.username, case when v.sound_id is null then 1 else 0 end)
  on conflict (original_video_id) do update
    set audio_url = excluded.audio_url,
        title = coalesce(nullif(public.sounds.title, ''), excluded.title),
        creator_username = excluded.creator_username
  returning id into s_id;

  update public.videos
     set sound_id = s_id
   where id = v.id
     and (sound_id is null or sound_id = s_id);

  return s_id;
end;
$$;

-- Attach a sound to a video and keep uses_count accurate. Used by the upload
-- flow after the user picks "Use sound from video".
create or replace function public.set_video_sound(_video_id uuid, _sound_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.videos%rowtype;
  old_id uuid;
begin
  select * into v from public.videos where id = _video_id for update;
  if not found then
    raise exception 'video not found';
  end if;

  if auth.uid() is not null
     and v.user_id is distinct from auth.uid()
     and not exists (
       select 1 from public.profiles p
       where p.id = auth.uid() and p.handle = v.username
     ) then
    raise exception 'not your video';
  end if;

  if _sound_id is not null and not exists (select 1 from public.sounds where id = _sound_id) then
    raise exception 'sound not found';
  end if;

  old_id := v.sound_id;
  if old_id is not distinct from _sound_id then
    return;
  end if;

  update public.videos set sound_id = _sound_id where id = _video_id;

  if old_id is not null then
    update public.sounds
       set uses_count = greatest(0, uses_count - 1)
     where id = old_id;
  end if;

  if _sound_id is not null then
    update public.sounds
       set uses_count = uses_count + 1
     where id = _sound_id;
  end if;
end;
$$;

-- Kept for compatibility with callers that only want to bump a counter.
create or replace function public.increment_sound_use(_sound_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.sounds set uses_count = uses_count + 1 where id = _sound_id;
$$;

-- ---------------------------------------------------------------------------
-- Auto-create a sound for every new video
-- ---------------------------------------------------------------------------

create or replace function public.videos_create_sound()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_sound_from_video(new.id);
  return new;
end;
$$;

drop trigger if exists videos_create_sound on public.videos;
create trigger videos_create_sound
  after insert on public.videos
  for each row execute function public.videos_create_sound();

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.sounds enable row level security;

drop policy if exists "sounds are public" on public.sounds;
create policy "sounds are public" on public.sounds
  for select using (true);

drop policy if exists "signed in users create sounds" on public.sounds;
create policy "signed in users create sounds" on public.sounds
  for insert to authenticated
  with check (auth.uid() is not null);

drop policy if exists "creators update own sounds" on public.sounds;
create policy "creators update own sounds" on public.sounds
  for update to authenticated
  using (auth.uid() is not null)
  with check (auth.uid() is not null);

grant select on public.sounds to anon, authenticated;
grant execute on function public.create_sound_from_video(uuid) to anon, authenticated;
grant execute on function public.set_video_sound(uuid, uuid) to anon, authenticated;
grant execute on function public.increment_sound_use(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Backfill: give every existing video an original sound.
-- ---------------------------------------------------------------------------

do $$
declare
  r record;
begin
  for r in select id from public.videos where sound_id is null loop
    perform public.create_sound_from_video(r.id);
  end loop;
end $$;
