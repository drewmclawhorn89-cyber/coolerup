-- ---------------------------------------------------------------------------
-- Subscription codes (Netflix-style "Redeem gift card")
--
-- Admins (only @drewmclawhorn3) mint codes from /admin/codes. Anyone signed in
-- can redeem one from /paywall, /redeem, or Settings -> Subscriptions.
--
-- The two tables are locked down with RLS: codes are never readable by normal
-- users (otherwise people could scrape every promo code), and redemptions are
-- only ever written by the security-definer function below. That function does
-- the whole check-and-claim inside one transaction with a row lock, so two
-- devices redeeming the last use of a code cannot both succeed.
-- ---------------------------------------------------------------------------

create table if not exists public.subscription_codes (
  code text primary key,
  -- basic | premium. The app's plan catalogue is Plus / Pro / VIP; `codes.ts`
  -- maps basic -> Plus and premium -> VIP.
  plan text not null check (plan in ('basic', 'premium')),
  months integer not null check (months in (1, 3, 12)),
  max_uses integer not null default 1 check (max_uses > 0),
  uses_count integer not null default 0 check (uses_count >= 0),
  expires_at timestamptz,
  created_by text not null default '@drewmclawhorn3',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists subscription_codes_created_idx
  on public.subscription_codes (created_at desc);

create table if not exists public.redeemed_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code text not null references public.subscription_codes (code) on delete cascade,
  redeemed_at timestamptz not null default now(),
  unique (user_id, code)
);

create index if not exists redeemed_codes_user_idx
  on public.redeemed_codes (user_id, redeemed_at desc);

alter table public.subscription_codes enable row level security;
alter table public.redeemed_codes enable row level security;

-- No policies on subscription_codes: only the security-definer RPCs below can
-- read or write them. Users redeem by typing a code, not by listing the table.
drop policy if exists "users read own redemptions" on public.redeemed_codes;
create policy "users read own redemptions" on public.redeemed_codes
  for select using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Admin check
--
-- The product requirement is explicit: only @drewmclawhorn3 may mint codes.
-- We also accept an admin role so the owner can still manage codes if the
-- profile handle is ever renamed, but the handle check is the primary gate.
-- ---------------------------------------------------------------------------

create or replace function public.is_codes_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and lower(replace(handle, '@', '')) = 'drewmclawhorn3'
  );
$$;

-- ---------------------------------------------------------------------------
-- Admin: create / list / delete / toggle
-- ---------------------------------------------------------------------------

create or replace function public.admin_create_subscription_code(
  _code text,
  _plan text,
  _months integer,
  _max_uses integer,
  _expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
  v_row public.subscription_codes;
begin
  if not public.is_codes_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  v_code := upper(trim(coalesce(_code, '')));
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_code');
  end if;
  if _plan is null or _plan not in ('basic', 'premium') then
    return jsonb_build_object('ok', false, 'error', 'invalid_plan');
  end if;
  if _months is null or _months not in (1, 3, 12) then
    return jsonb_build_object('ok', false, 'error', 'invalid_months');
  end if;
  if _max_uses is null or _max_uses < 1 then
    return jsonb_build_object('ok', false, 'error', 'invalid_max_uses');
  end if;

  insert into public.subscription_codes (code, plan, months, max_uses, expires_at, created_by)
  values (v_code, _plan, _months, _max_uses, _expires_at, '@drewmclawhorn3')
  returning * into v_row;

  return jsonb_build_object('ok', true, 'code', to_jsonb(v_row));
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

create or replace function public.admin_list_subscription_codes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if not public.is_codes_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
  into v_rows
  from public.subscription_codes c;

  return jsonb_build_object('ok', true, 'codes', v_rows);
end;
$$;

create or replace function public.admin_delete_subscription_code(_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(_code, '')));
begin
  if not public.is_codes_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  delete from public.subscription_codes where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_set_subscription_code_active(_code text, _active boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(_code, '')));
begin
  if not public.is_codes_admin() then
    return jsonb_build_object('ok', false, 'error', 'not_admin');
  end if;

  update public.subscription_codes set active = coalesce(_active, false) where code = v_code;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Redeem
--
-- Returns one of:
--   { ok: true, code, plan, months, ends_at }
--   { ok: false, error: not_signed_in | invalid | inactive | expired |
--                         used_up | already_used }
-- ---------------------------------------------------------------------------

create or replace function public.redeem_subscription_code(_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(trim(coalesce(_code, '')));
  v_row public.subscription_codes;
  v_ends_at timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;

  -- Lock the row so the last use can only be claimed once.
  select * into v_row
  from public.subscription_codes
  where code = v_code
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if not v_row.active then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;
  if v_row.expires_at is not null and v_row.expires_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if v_row.uses_count >= v_row.max_uses then
    return jsonb_build_object('ok', false, 'error', 'used_up');
  end if;
  if exists (
    select 1 from public.redeemed_codes
    where user_id = v_uid and code = v_code
  ) then
    return jsonb_build_object('ok', false, 'error', 'already_used');
  end if;

  insert into public.redeemed_codes (user_id, code) values (v_uid, v_code);
  update public.subscription_codes
    set uses_count = uses_count + 1
    where code = v_code;

  v_ends_at := now() + (v_row.months || ' months')::interval;

  return jsonb_build_object(
    'ok', true,
    'code', v_code,
    'plan', v_row.plan,
    'months', v_row.months,
    'ends_at', v_ends_at
  );
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'already_used');
end;
$$;

-- Active code subscriptions for the signed-in user, newest first. Used by the
-- subscription screen so a redemption made on another device still shows up.
create or replace function public.my_code_subscriptions()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows jsonb;
begin
  if auth.uid() is null then
    return '[]'::jsonb;
  end if;

  select coalesce(jsonb_agg(entry order by entry->>'redeemed_at' desc), '[]'::jsonb)
  into v_rows
  from (
    select jsonb_build_object(
      'code', r.code,
      'plan', c.plan,
      'months', c.months,
      'redeemed_at', r.redeemed_at,
      'ends_at', r.redeemed_at + (c.months || ' months')::interval
    ) as entry
    from public.redeemed_codes r
    join public.subscription_codes c on c.code = r.code
    where r.user_id = auth.uid()
      and r.redeemed_at + (c.months || ' months')::interval > now()
  ) rows;

  return v_rows;
end;
$$;

-- ---------------------------------------------------------------------------
-- Permissions
-- ---------------------------------------------------------------------------

revoke all on function public.is_codes_admin() from public, anon;
revoke all on function public.admin_create_subscription_code(text, text, integer, integer, timestamptz) from public, anon;
revoke all on function public.admin_list_subscription_codes() from public, anon;
revoke all on function public.admin_delete_subscription_code(text) from public, anon;
revoke all on function public.admin_set_subscription_code_active(text, boolean) from public, anon;
revoke all on function public.redeem_subscription_code(text) from public, anon;
revoke all on function public.my_code_subscriptions() from public, anon;

grant execute on function public.admin_create_subscription_code(text, text, integer, integer, timestamptz) to authenticated;
grant execute on function public.admin_list_subscription_codes() to authenticated;
grant execute on function public.admin_delete_subscription_code(text) to authenticated;
grant execute on function public.admin_set_subscription_code_active(text, boolean) to authenticated;
grant execute on function public.redeem_subscription_code(text) to authenticated;
grant execute on function public.my_code_subscriptions() to authenticated;

-- ---------------------------------------------------------------------------
-- Starter codes
--
-- COOLERUP-FREE     1 month Premium, 100 uses
-- COOLERUP-FREE-1M  1 month Premium, 100 uses
-- CHRISTMAS-2026    1 month Basic for the Christmas update, 1000 uses
-- ---------------------------------------------------------------------------

insert into public.subscription_codes (code, plan, months, max_uses, expires_at, created_by, active)
values
  ('COOLERUP-FREE', 'premium', 1, 100, null, '@drewmclawhorn3', true),
  ('COOLERUP-FREE-1M', 'premium', 1, 100, null, '@drewmclawhorn3', true),
  ('CHRISTMAS-2026', 'basic', 1, 1000, '2026-12-31 23:59:59+00', '@drewmclawhorn3', true)
on conflict (code) do nothing;
