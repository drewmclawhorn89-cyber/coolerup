-- ---------------------------------------------------------------------------
-- GTA 6 challenge: post 10 GTA videos during the event -> 1 month of Pro free.
--
-- The event runs Nov 8 - Nov 15 2026 and never comes back, so this reward is
-- claimable exactly once per account and only inside the window. Everything is
-- decided in Postgres:
--
--   * the post count is read from public.videos, not sent by the client
--   * the window is re-checked on every call, so a patched client cannot claim
--     after Nov 15
--   * `gta6_challenge_claims.user_id` is the primary key, so a double-tap or a
--     second device cannot mint two months
--
-- The grant itself is stored client-side by `applyCodeSubscription` (the same
-- path subscription codes use), so this migration only needs to record who won
-- what and until when.
-- ---------------------------------------------------------------------------

create table if not exists public.gta6_challenge_claims (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  handle text not null,
  videos_count integer not null default 0,
  -- The app's plan catalogue is plus / pro / vip.
  plan text not null default 'pro',
  months integer not null default 1,
  claimed_at timestamptz not null default now(),
  ends_at timestamptz not null
);

create index if not exists gta6_challenge_claims_claimed_idx
  on public.gta6_challenge_claims (claimed_at desc);

alter table public.gta6_challenge_claims enable row level security;

-- A user can see their own reward (so a fresh device can restore the grant).
-- Nobody can insert/update/delete directly: rows only come from the RPC below.
drop policy if exists "users read own gta6 challenge claim" on public.gta6_challenge_claims;
create policy "users read own gta6 challenge claim"
  on public.gta6_challenge_claims
  for select
  using (user_id = auth.uid());

grant select on public.gta6_challenge_claims to authenticated;

-- ---------------------------------------------------------------------------
-- Shared helpers
-- ---------------------------------------------------------------------------

-- The event window, in one place, so every function agrees.
create or replace function public.gta6_window()
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
immutable
as $$
  select '2026-11-08 00:00:00'::timestamptz,
         '2026-11-15 23:59:59'::timestamptz;
$$;

/**
 * How many qualifying GTA videos the given user has posted.
 *
 * A qualifying post is a video created inside the event window whose caption
 * carries the #GTA6Coolerup hashtag. Matching is case-insensitive.
 *
 * Videos are matched on `user_id` when it is set (that is the authoritative
 * owner) and fall back to the profile handle for older rows, because the upload
 * path only writes `username`.
 */
create or replace function public.gta6_video_count(_uid uuid, _handle text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.videos v
  cross join public.gta6_window() w
  where v.created_at >= w.starts_at
    and v.created_at <= w.ends_at
    and v.caption ilike '%#GTA6Coolerup%'
    and (
      v.user_id = _uid
      or (_handle is not null and lower(replace(v.username, '@', '')) = _handle)
    );
$$;

-- ---------------------------------------------------------------------------
-- Progress: what the challenge card shows
--
-- Returns:
--   { ok, posted, required, eligible, claimed, plan, months, ends_at }
-- ---------------------------------------------------------------------------
create or replace function public.gta6_challenge_progress()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_posted integer := 0;
  v_required integer := 10;
  v_claim public.gta6_challenge_claims;
  v_has_claim boolean := false;
  v_window_end timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select lower(replace(p.handle, '@', ''))
    into v_handle
    from public.profiles p
   where p.id = v_uid;

  v_posted := public.gta6_video_count(v_uid, v_handle);

  select * into v_claim
  from public.gta6_challenge_claims
  where user_id = v_uid;
  v_has_claim := found;

  select w.ends_at into v_window_end from public.gta6_window() w;

  return jsonb_build_object(
    'ok', true,
    'posted', v_posted,
    'required', v_required,
    'eligible', v_posted >= v_required,
    'claimed', v_has_claim,
    'plan', coalesce(v_claim.plan, 'pro'),
    'months', coalesce(v_claim.months, 1),
    'claimed_ends_at', v_claim.ends_at,
    'ends_at', v_window_end
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Claim: grant 1 month of Pro
--
-- Returns one of:
--   { ok: true,  plan, months, ends_at }
--   { ok: false, error: not_signed_in | not_enough_videos | already_claimed |
--                         ended, posted, required }
-- ---------------------------------------------------------------------------
create or replace function public.claim_gta6_challenge()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_posted integer := 0;
  v_required integer := 10;
  v_end timestamptz;
  v_ends_at timestamptz;
  v_existing timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select w.ends_at into v_end from public.gta6_window() w;

  -- One-way door: after Nov 15 2026 the reward can never be claimed.
  if now() > v_end then
    return jsonb_build_object('ok', false, 'error', 'ended', 'posted', 0, 'required', v_required);
  end if;

  select lower(replace(p.handle, '@', ''))
    into v_handle
    from public.profiles p
   where p.id = v_uid;

  if v_handle is null or v_handle = '' then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  -- Already claimed? Hand back the existing end date instead of a second month.
  select c.ends_at into v_existing
  from public.gta6_challenge_claims c
  where c.user_id = v_uid;

  if v_existing is not null then
    return jsonb_build_object(
      'ok', false,
      'error', 'already_claimed',
      'ends_at', v_existing
    );
  end if;

  v_posted := public.gta6_video_count(v_uid, v_handle);

  if v_posted < v_required then
    return jsonb_build_object(
      'ok', false,
      'error', 'not_enough_videos',
      'posted', v_posted,
      'required', v_required
    );
  end if;

  v_ends_at := now() + interval '1 month';

  insert into public.gta6_challenge_claims (user_id, handle, videos_count, plan, months, ends_at)
  values (v_uid, v_handle, v_posted, 'pro', 1, v_ends_at)
  on conflict (user_id) do nothing;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'plan', 'pro',
    'months', 1,
    'ends_at', v_ends_at
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_claimed');
end;
$$;

-- ---------------------------------------------------------------------------
-- Restore: the grant for the signed-in user, if any
--
-- The subscription record lives in localStorage, so a new device would
-- otherwise look like the reward was never claimed. This lets the client
-- re-apply the grant on sign-in.
-- ---------------------------------------------------------------------------
create or replace function public.my_gta6_challenge_reward()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_claim public.gta6_challenge_claims;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select * into v_claim
  from public.gta6_challenge_claims
  where user_id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_claimed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'plan', v_claim.plan,
    'months', v_claim.months,
    'claimed_at', v_claim.claimed_at,
    'ends_at', v_claim.ends_at
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on function public.gta6_window() from public, anon;
revoke all on function public.gta6_video_count(uuid, text) from public, anon, authenticated;
revoke all on function public.gta6_challenge_progress() from public, anon;
revoke all on function public.claim_gta6_challenge() from public, anon;
revoke all on function public.my_gta6_challenge_reward() from public, anon;

grant execute on function public.gta6_challenge_progress() to authenticated;
grant execute on function public.claim_gta6_challenge() to authenticated;
grant execute on function public.my_gta6_challenge_reward() to authenticated;
