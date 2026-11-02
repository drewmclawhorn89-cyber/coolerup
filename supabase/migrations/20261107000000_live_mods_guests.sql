-- TikTok-style LIVE moderation and multi-guest co-hosting.
--
-- STRICTLY ADDITIVE. New tables, indexes, policies and functions only. No
-- existing row is dropped, rewritten or re-typed, so every video, like,
-- comment, follower, gift and profile stays exactly as it is.
--
-- NOTE ON live_id: Coolerup LIVE streams are ephemeral Supabase realtime rooms
-- keyed by the host's user id (see LiveStreamDialog). There is no `lives`
-- table, so live_id is TEXT holding that room key. That also means the host of
-- a room is simply `auth.uid()::text = live_id`, which is how every host-only
-- check below works.

-- ---------------------------------------------------------------------------
-- 1. Moderators
-- ---------------------------------------------------------------------------

create table if not exists public.live_mods (
  id uuid primary key default gen_random_uuid(),
  live_id text not null,
  -- The moderator.
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- The host who promoted them. Only the host can add or remove.
  added_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (live_id, user_id)
);

create index if not exists live_mods_live_idx on public.live_mods (live_id, created_at);

-- ---------------------------------------------------------------------------
-- 2. Mutes
-- ---------------------------------------------------------------------------

create table if not exists public.live_mutes (
  id uuid primary key default gen_random_uuid(),
  live_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  muted_by uuid not null references public.profiles (id) on delete cascade,
  -- null = permanent for the rest of this stream.
  until timestamptz,
  created_at timestamptz not null default now(),
  unique (live_id, user_id)
);

create index if not exists live_mutes_live_idx on public.live_mutes (live_id, created_at);

-- ---------------------------------------------------------------------------
-- 3. Join requests
-- ---------------------------------------------------------------------------

create table if not exists public.live_join_requests (
  id uuid primary key default gen_random_uuid(),
  live_id text not null,
  requester_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'ended')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- One pending request per person per stream. A rejected viewer may ask again.
create unique index if not exists live_join_requests_pending_idx
  on public.live_join_requests (live_id, requester_id)
  where status = 'pending';
create index if not exists live_join_requests_live_idx
  on public.live_join_requests (live_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. Guests on stage
-- ---------------------------------------------------------------------------

create table if not exists public.live_guests (
  id uuid primary key default gen_random_uuid(),
  live_id text not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (live_id, user_id)
);

create index if not exists live_guests_live_idx on public.live_guests (live_id, is_active);

-- ---------------------------------------------------------------------------
-- 5. Per-stream room state (pinned comment, comments off)
-- ---------------------------------------------------------------------------

create table if not exists public.live_room_state (
  live_id text primary key,
  comments_off boolean not null default false,
  -- { id, username, body, at } of the pinned chat line.
  pinned jsonb,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. Row level security
-- ---------------------------------------------------------------------------

alter table public.live_mods enable row level security;
alter table public.live_mutes enable row level security;
alter table public.live_join_requests enable row level security;
alter table public.live_guests enable row level security;
alter table public.live_room_state enable row level security;

-- Mod lists are public so every viewer can render the shield badge.
drop policy if exists "live mods are public" on public.live_mods;
create policy "live mods are public"
  on public.live_mods for select using (true);

-- Mute state is public to the room so clients can grey out the input.
drop policy if exists "live mutes are public" on public.live_mutes;
create policy "live mutes are public"
  on public.live_mutes for select using (true);

-- Requests are visible to the requester and to the host only.
drop policy if exists "join requests visible to host and requester" on public.live_join_requests;
create policy "join requests visible to host and requester"
  on public.live_join_requests for select
  using (auth.uid() = requester_id or auth.uid()::text = live_id);

drop policy if exists "live guests are public" on public.live_guests;
create policy "live guests are public"
  on public.live_guests for select using (true);

drop policy if exists "live room state is public" on public.live_room_state;
create policy "live room state is public"
  on public.live_room_state for select using (true);

-- No insert/update/delete policies anywhere: every write goes through the
-- security-definer functions below, so a client can never promote itself to
-- moderator, clear its own mute, or accept its own join request.

-- ---------------------------------------------------------------------------
-- 7. Permission helper
-- ---------------------------------------------------------------------------

create or replace function public.is_live_mod(p_live_id text, p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.live_mods
     where live_id = p_live_id and user_id = p_user_id
  );
$$;

revoke all on function public.is_live_mod(text, uuid) from public;
grant execute on function public.is_live_mod(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Moderator management (host only, max 20)
-- ---------------------------------------------------------------------------

create or replace function public.add_live_mod(p_live_id text, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_count integer;
begin
  if v_host is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_host::text <> p_live_id then
    raise exception 'host_only' using errcode = '42501';
  end if;
  if p_user_id = v_host then
    raise exception 'cannot_mod_yourself' using errcode = '22023';
  end if;

  select count(*) into v_count from public.live_mods where live_id = p_live_id;
  if v_count >= 20 then
    raise exception 'mod_limit_reached' using errcode = 'P0001';
  end if;

  insert into public.live_mods (live_id, user_id, added_by)
  values (p_live_id, p_user_id, v_host)
  on conflict (live_id, user_id) do nothing;

  select count(*) into v_count from public.live_mods where live_id = p_live_id;
  return v_count;
end;
$$;

create or replace function public.remove_live_mod(p_live_id text, p_user_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_count integer;
begin
  if v_host is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_host::text <> p_live_id then
    raise exception 'host_only' using errcode = '42501';
  end if;

  delete from public.live_mods where live_id = p_live_id and user_id = p_user_id;

  select count(*) into v_count from public.live_mods where live_id = p_live_id;
  return v_count;
end;
$$;

revoke all on function public.add_live_mod(text, uuid) from public;
revoke all on function public.remove_live_mod(text, uuid) from public;
grant execute on function public.add_live_mod(text, uuid) to authenticated;
grant execute on function public.remove_live_mod(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Mutes (host or mod)
-- ---------------------------------------------------------------------------

create or replace function public.mute_live_user(
  p_live_id text,
  p_user_id uuid,
  p_minutes integer default null
)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_until timestamptz;
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_actor::text <> p_live_id and not public.is_live_mod(p_live_id, v_actor) then
    raise exception 'moderator_only' using errcode = '42501';
  end if;
  if p_user_id = v_actor or p_user_id::text = p_live_id then
    raise exception 'cannot_mute_self_or_host' using errcode = '22023';
  end if;

  -- p_minutes null or <= 0 means permanent for this stream.
  v_until := case
    when p_minutes is null or p_minutes <= 0 then null
    else now() + make_interval(mins => p_minutes)
  end;

  insert into public.live_mutes (live_id, user_id, muted_by, until)
  values (p_live_id, p_user_id, v_actor, v_until)
  on conflict (live_id, user_id) do update
    set muted_by = excluded.muted_by,
        until = excluded.until,
        created_at = now();

  return v_until;
end;
$$;

create or replace function public.unmute_live_user(p_live_id text, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_actor::text <> p_live_id and not public.is_live_mod(p_live_id, v_actor) then
    raise exception 'moderator_only' using errcode = '42501';
  end if;

  delete from public.live_mutes where live_id = p_live_id and user_id = p_user_id;
end;
$$;

revoke all on function public.mute_live_user(text, uuid, integer) from public;
revoke all on function public.unmute_live_user(text, uuid) from public;
grant execute on function public.mute_live_user(text, uuid, integer) to authenticated;
grant execute on function public.unmute_live_user(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. Room state: pin a comment, turn comments off
-- ---------------------------------------------------------------------------

create or replace function public.set_live_comments(p_live_id text, p_off boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_actor::text <> p_live_id and not public.is_live_mod(p_live_id, v_actor) then
    raise exception 'moderator_only' using errcode = '42501';
  end if;

  insert into public.live_room_state (live_id, comments_off, updated_at)
  values (p_live_id, coalesce(p_off, false), now())
  on conflict (live_id) do update
    set comments_off = excluded.comments_off, updated_at = now();

  return coalesce(p_off, false);
end;
$$;

create or replace function public.pin_live_message(p_live_id text, p_message jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_actor::text <> p_live_id and not public.is_live_mod(p_live_id, v_actor) then
    raise exception 'moderator_only' using errcode = '42501';
  end if;

  insert into public.live_room_state (live_id, pinned, updated_at)
  values (p_live_id, p_message, now())
  on conflict (live_id) do update
    set pinned = excluded.pinned, updated_at = now();

  return p_message;
end;
$$;

revoke all on function public.set_live_comments(text, boolean) from public;
revoke all on function public.pin_live_message(text, jsonb) from public;
grant execute on function public.set_live_comments(text, boolean) to authenticated;
grant execute on function public.pin_live_message(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Join requests
-- ---------------------------------------------------------------------------

create or replace function public.request_join_live(p_live_id text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_me uuid := auth.uid();
  v_id uuid;
  v_active integer;
begin
  if v_me is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_me::text = p_live_id then
    raise exception 'cannot_join_own_stream' using errcode = '22023';
  end if;

  select count(*) into v_active
    from public.live_guests
   where live_id = p_live_id and is_active;

  if v_active >= 4 then
    raise exception 'stage_full' using errcode = 'P0001';
  end if;

  -- Already on stage? Nothing to do.
  if exists (
    select 1 from public.live_guests
     where live_id = p_live_id and user_id = v_me and is_active
  ) then
    raise exception 'already_on_stage' using errcode = 'P0001';
  end if;

  select id into v_id
    from public.live_join_requests
   where live_id = p_live_id and requester_id = v_me and status = 'pending'
   limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.live_join_requests (live_id, requester_id, status)
  values (p_live_id, v_me, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.respond_join_request(p_request_id uuid, p_accept boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
  v_request public.live_join_requests;
  v_active integer;
begin
  if v_host is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;

  select * into v_request from public.live_join_requests where id = p_request_id;
  if v_request.id is null then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_host::text <> v_request.live_id then
    raise exception 'host_only' using errcode = '42501';
  end if;

  if not p_accept then
    update public.live_join_requests
       set status = 'rejected', responded_at = now()
     where id = p_request_id;
    return 'rejected';
  end if;

  select count(*) into v_active
    from public.live_guests
   where live_id = v_request.live_id and is_active;

  if v_active >= 4 then
    raise exception 'stage_full' using errcode = 'P0001';
  end if;

  update public.live_join_requests
     set status = 'accepted', responded_at = now()
   where id = p_request_id;

  insert into public.live_guests (live_id, user_id, is_active)
  values (v_request.live_id, v_request.requester_id, true)
  on conflict (live_id, user_id) do update
    set is_active = true, joined_at = now();

  return 'accepted';
end;
$$;

create or replace function public.leave_live_guest(p_live_id text, p_user_id uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_target uuid := coalesce(p_user_id, auth.uid());
begin
  if v_actor is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_actor <> v_target and v_actor::text <> p_live_id then
    raise exception 'host_only' using errcode = '42501';
  end if;

  update public.live_guests
     set is_active = false
   where live_id = p_live_id and user_id = v_target;

  update public.live_join_requests
     set status = 'ended', responded_at = now()
   where live_id = p_live_id and requester_id = v_target and status = 'accepted';
end;
$$;

revoke all on function public.request_join_live(text) from public;
revoke all on function public.respond_join_request(uuid, boolean) from public;
revoke all on function public.leave_live_guest(text, uuid) from public;
grant execute on function public.request_join_live(text) to authenticated;
grant execute on function public.respond_join_request(uuid, boolean) to authenticated;
grant execute on function public.leave_live_guest(text, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. End of stream cleanup
-- ---------------------------------------------------------------------------

create or replace function public.end_live_session(p_live_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_host uuid := auth.uid();
begin
  if v_host is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if v_host::text <> p_live_id then
    raise exception 'host_only' using errcode = '42501';
  end if;

  update public.live_join_requests
     set status = 'ended', responded_at = now()
   where live_id = p_live_id and status in ('pending', 'accepted');

  update public.live_guests
     set is_active = false
   where live_id = p_live_id and is_active;

  delete from public.live_mutes where live_id = p_live_id;
  delete from public.live_mods where live_id = p_live_id;
  delete from public.live_room_state where live_id = p_live_id;
end;
$$;

revoke all on function public.end_live_session(text) from public;
grant execute on function public.end_live_session(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Realtime
-- ---------------------------------------------------------------------------

-- Best effort: adding tables to the publication can fail if it is already
-- configured, so each one is guarded.
do $$
begin
  alter publication supabase_realtime add table public.live_join_requests;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_guests;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_mods;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_mutes;
exception when others then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.live_room_state;
exception when others then null;
end $$;
