-- Store user's selected app theme on their account profile so it syncs across devices.
alter table public.profiles
  add column if not exists theme text;
