-- ===========================================================================
-- Coolerup — Music tab: "Your Sounds" (saved songs)
--
-- This does NOT create a new songs table. It only adds a join table that
-- records which existing `public.sounds` rows a user saved with the heart
-- button in the Music tab, so "Your Sounds" survives a reload.
-- ===========================================================================

create table if not exists public.saved_sounds (
  user_id uuid not null references public.profiles (id) on delete cascade,
  sound_id uuid not null references public.sounds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, sound_id)
);

create index if not exists saved_sounds_user_idx
  on public.saved_sounds (user_id, created_at desc);

alter table public.saved_sounds enable row level security;

drop policy if exists "users read their own saved sounds" on public.saved_sounds;
create policy "users read their own saved sounds"
  on public.saved_sounds for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "users save their own sounds" on public.saved_sounds;
create policy "users save their own sounds"
  on public.saved_sounds for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "users unsave their own sounds" on public.saved_sounds;
create policy "users unsave their own sounds"
  on public.saved_sounds for delete
  to authenticated
  using (user_id = auth.uid());

notify pgrst, 'reload schema';

-- Verification: should return 1 row (the table).
select table_name
from information_schema.tables
where table_schema = 'public' and table_name = 'saved_sounds';
