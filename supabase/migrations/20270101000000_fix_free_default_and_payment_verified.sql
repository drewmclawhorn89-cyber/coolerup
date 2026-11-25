-- ===========================================================================
-- 20270101000000 · DEFAULT TO FREE (NEVER FOREVER), REQUIRE payment_verified,
--                  CHECK EXPIRY ON MONTHLY/YEARLY PLANS & CLEAN EXISTING USERS
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Ensure `all` ("All Access Forever") exists in `public.subscription_plans`
-- ---------------------------------------------------------------------------

insert into public.subscription_plans (
  id, plan_name, emoji, price_cents, perks, offline, music_offline, background_play, sort_order, active
)
values
  (
    'all',
    'All Access Forever',
    '👑',
    9999,
    '["Everything in Plus, Pro and VIP","Offline video downloads","Offline music downloads","Background play","Beta features","Never expires"]'::jsonb,
    true,
    true,
    true,
    4,
    true
  )
on conflict (id) do update set
  plan_name = excluded.plan_name,
  emoji = excluded.emoji,
  price_cents = excluded.price_cents,
  perks = excluded.perks,
  offline = excluded.offline,
  music_offline = excluded.music_offline,
  background_play = excluded.background_play,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Add `payment_verified` & set SAFE 'free' defaults (never 'active'/'all')
-- ---------------------------------------------------------------------------

alter table public.user_subscriptions
  add column if not exists payment_verified boolean not null default false;

alter table public.user_subscriptions
  alter column plan_id set default 'free',
  alter column plan_name set default 'Free',
  alter column plan_status set default 'free',
  alter column status set default 'free',
  alter column payment_verified set default false,
  alter column auto_renew set default false;

alter table public.user_subscriptions
  drop constraint if exists user_subscriptions_plan_status_check;

alter table public.user_subscriptions
  add constraint user_subscriptions_plan_status_check
  check (plan_status in ('free', 'active', 'pending', 'cancelled', 'expired', 'trialing'));

do $$
begin
  if to_regclass('public.subscriptions') is not null then
    alter table public.subscriptions
      add column if not exists payment_verified boolean not null default false;

    alter table public.subscriptions
      alter column plan set default 'free',
      alter column status set default 'free',
      alter column is_lifetime set default false,
      alter column payment_verified set default false;

    alter table public.subscriptions
      drop constraint if exists subscriptions_plan_check;
    alter table public.subscriptions
      add constraint subscriptions_plan_check
      check (plan in ('free', 'plus', 'pro', 'vip', 'all'));

    alter table public.subscriptions
      drop constraint if exists subscriptions_status_check;
    alter table public.subscriptions
      add constraint subscriptions_status_check
      check (status in ('free', 'active', 'pending', 'canceled', 'expired'));
  end if;

  if to_regclass('public.profiles') is not null then
    alter table public.profiles add column if not exists plan_id text;
    alter table public.profiles add column if not exists plan_name text;
    alter table public.profiles add column if not exists plan_status text;
    alter table public.profiles add column if not exists plan_started_at timestamptz;
    alter table public.profiles add column if not exists plan_expires_at timestamptz;
    alter table public.profiles add column if not exists payment_method text;
    alter table public.profiles add column if not exists payment_verified boolean not null default false;

    alter table public.profiles
      alter column plan_id set default 'free',
      alter column plan_name set default 'Free',
      alter column plan_status set default 'free',
      alter column payment_verified set default false;
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Fix existing users (NON-DESTRUCTIVE — keeps all users & videos intact)
--    - Anyone on "All Access Forever" with NO verified payment -> Free.
--    - Owner @drewmclawhorn3 keeps All Access Forever.
--    - Expired Monthly/Yearly rows -> status = 'expired'.
-- ---------------------------------------------------------------------------

-- 3a. Mark rows with real verified non-Venmo payment or gift-code redemption.
update public.user_subscriptions us
set
  payment_verified = true,
  plan_name = case
    when us.plan_id = 'all' then 'All Access Forever'
    else coalesce(
      nullif(us.plan_name, ''),
      (select sp.plan_name from public.subscription_plans sp where sp.id = us.plan_id),
      initcap(us.plan_id)
    )
  end,
  expires_at = case when us.plan_id = 'all' then null else us.expires_at end
where coalesce(us.plan_status, us.status) in ('active', 'trialing')
  and us.plan_id <> 'free'
  and (us.expires_at is null or us.expires_at > now())
  and (
    us.payment_verified = true
    or (
      coalesce(trim(us.payment_method), '') <> ''
      and lower(trim(us.payment_method)) not in ('free', 'none', 'null', 'pending', 'venmo')
    )
    or exists (
      select 1 from public.profiles p
      where p.id = us.user_id
        and (
          lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
          or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
        )
    )
  );

-- 3b. Reset ALL non-owner "All Access Forever" rows that have NO payment record -> Free.
update public.user_subscriptions us
set
  plan_id = 'free',
  plan_name = 'Free',
  plan_status = 'free',
  status = 'free',
  payment_verified = false,
  payment_method = null,
  expires_at = null,
  auto_renew = false,
  updated_at = now()
where (
  us.plan_id = 'all'
  or lower(coalesce(us.plan_name, '')) like '%all access forever%'
  or lower(coalesce(us.plan_name, '')) like '%lifetime all access%'
)
  and not (
    us.payment_verified = true
    and coalesce(us.plan_status, us.status) = 'active'
  )
  and not exists (
    select 1 from public.profiles p
    where p.id = us.user_id
      and (
        lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
      )
  );

-- 3c. Expire Monthly/Yearly subscriptions past `expires_at`.
update public.user_subscriptions us
set
  plan_status = 'expired',
  status = 'expired',
  auto_renew = false,
  updated_at = now()
where us.plan_id not in ('all', 'free')
  and coalesce(us.plan_status, us.status) in ('active', 'trialing')
  and us.expires_at is not null
  and us.expires_at <= now();

-- 3d. Clean `public.subscriptions` (lifetime grants table) non-destructively.
do $$
begin
  if to_regclass('public.subscriptions') is not null then
    -- Preserve real buyers who have a verified 'all' payment in user_subscriptions.
    update public.subscriptions s
    set
      payment_verified = true,
      current_period_end = null,
      updated_at = now()
    where s.plan = 'all'
      and s.status = 'active'
      and exists (
        select 1 from public.user_subscriptions us
        where us.user_id = s.user_id
          and us.plan_id = 'all'
          and us.plan_status = 'active'
          and us.payment_verified = true
      );

    -- Preserve owner @drewmclawhorn3.
    if to_regclass('public.profiles') is not null then
      insert into public.subscriptions (
        user_id, plan, status, is_lifetime, payment_verified, granted_by, revoked_at, current_period_end, updated_at
      )
      select
        p.id, 'all', 'active', true, true, 'drewmclawhorn3', null, null, now()
      from public.profiles p
      where lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
         or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
      on conflict (user_id) do update set
        plan = 'all',
        status = 'active',
        is_lifetime = true,
        payment_verified = true,
        granted_by = 'drewmclawhorn3',
        revoked_at = null,
        current_period_end = null,
        updated_at = now();
    end if;

    -- Reset ALL other unverified Forever/lifetime rows back to Free.
    update public.subscriptions s
    set
      plan = 'free',
      status = 'free',
      is_lifetime = false,
      payment_verified = false,
      granted_by = null,
      current_period_end = null,
      updated_at = now()
    where (s.plan = 'all' or s.is_lifetime = true)
      and coalesce(s.payment_verified, false) = false
      and not exists (
        select 1 from public.profiles p
        where p.id = s.user_id
          and (
            lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
            or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
          )
      );
  end if;
end
$$;

-- 3e. Sync cleaned plan metadata back to `public.profiles`.
do $$
begin
  if to_regclass('public.profiles') is not null then
    update public.profiles p
    set
      plan_id = us.plan_id,
      plan_name = us.plan_name,
      plan_status = us.plan_status,
      plan_started_at = us.started_at,
      plan_expires_at = us.expires_at,
      payment_method = us.payment_method,
      payment_verified = us.payment_verified
    from public.user_subscriptions us
    where us.user_id = p.id;

    update public.profiles p
    set
      plan_id = 'free',
      plan_name = 'Free',
      plan_status = 'free',
      plan_expires_at = null,
      payment_method = null,
      payment_verified = false
    where not exists (
      select 1 from public.user_subscriptions us where us.user_id = p.id
    )
      and not (
        lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
      )
      and (
        p.plan_id is null
        or p.plan_id = 'all'
        or lower(coalesce(p.plan_name, '')) like '%all access forever%'
        or lower(coalesce(p.plan_name, '')) like '%lifetime all access%'
      );

    update public.profiles p
    set
      plan_id = 'all',
      plan_name = 'All Access Forever',
      plan_status = 'active',
      plan_expires_at = null,
      payment_verified = true
    where lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
       or lower(coalesce(p.username, '')) = 'drewmclawhorn3';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 4. Triggers & RPCs — default 'free', enforce payment_verified & expiry
-- ---------------------------------------------------------------------------

create or replace function public.sync_user_subscriptions_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_plan_name text;
  v_is_owner boolean := false;
begin
  new.plan_id := coalesce(nullif(trim(new.plan_id), ''), 'free');

  if tg_op = 'INSERT' then
    new.plan_status := coalesce(nullif(trim(new.plan_status), ''), nullif(trim(new.status), ''), 'free');
    new.status := new.plan_status;
  else
    if new.plan_status is distinct from old.plan_status and nullif(trim(new.plan_status), '') is not null then
      new.status := new.plan_status;
    elsif new.status is distinct from old.status and nullif(trim(new.status), '') is not null then
      new.plan_status := new.status;
    else
      new.plan_status := coalesce(nullif(trim(new.plan_status), ''), nullif(trim(new.status), ''), 'free');
      new.status := new.plan_status;
    end if;
  end if;

  if new.plan_id = 'free' then
    new.plan_name := 'Free';
    new.plan_status := 'free';
    new.status := 'free';
    new.payment_verified := false;
    new.expires_at := null;
    new.auto_renew := false;
  elsif new.plan_id = 'all' or lower(coalesce(new.plan_name, '')) = 'all access forever' then
    new.plan_id := 'all';
    new.plan_name := 'All Access Forever';
    new.expires_at := null;
    new.auto_renew := false;

    if to_regclass('public.profiles') is not null then
      select exists (
        select 1 from public.profiles p
        where p.id = new.user_id
          and (
            lower(replace(coalesce(p.handle, ''), '@', '')) = 'drewmclawhorn3'
            or lower(coalesce(p.username, '')) = 'drewmclawhorn3'
          )
      ) into v_is_owner;
    end if;

    if v_is_owner then
      new.payment_verified := true;
    elsif new.plan_status = 'active' and coalesce(new.payment_verified, false) = false then
      raise exception 'All Access Forever requires a verified payment.';
    end if;
  else
    if new.plan_name is null or trim(new.plan_name) = '' then
      select sp.plan_name into v_plan_name
      from public.subscription_plans sp
      where sp.id = new.plan_id
      limit 1;
      new.plan_name := coalesce(v_plan_name, initcap(new.plan_id));
    end if;

    if new.plan_status in ('active', 'trialing')
       and new.expires_at is not null
       and new.expires_at <= now()
    then
      new.plan_status := 'expired';
      new.status := 'expired';
      new.auto_renew := false;
    end if;
  end if;

  new.started_at := coalesce(new.started_at, now());
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists user_subscriptions_sync_before on public.user_subscriptions;
create trigger user_subscriptions_sync_before
  before insert or update on public.user_subscriptions
  for each row execute function public.sync_user_subscriptions_before_write();

create or replace function public.sync_user_subscription_to_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.profiles') is not null then
    update public.profiles
    set
      plan_id = new.plan_id,
      plan_name = new.plan_name,
      plan_status = new.plan_status,
      plan_started_at = new.started_at,
      plan_expires_at = new.expires_at,
      payment_method = new.payment_method,
      payment_verified = new.payment_verified
    where id = new.user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists user_subscriptions_sync_profile on public.user_subscriptions;
create trigger user_subscriptions_sync_profile
  after insert or update on public.user_subscriptions
  for each row execute function public.sync_user_subscription_to_profile();

-- Update admin/owner lifetime grant RPCs so explicit owner grants record payment_verified = true.
do $$
begin
  if to_regclass('public.subscriptions') is not null then
    create or replace function public.admin_grant_lifetime(_handle text, _plan text)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $fn$
    declare
      v_handle text := lower(replace(trim(coalesce(_handle, '')), '@', ''));
      v_plan text := lower(trim(coalesce(_plan, '')));
      v_profile public.profiles;
      v_existing public.subscriptions;
      v_was_all boolean := false;
    begin
      if not public.is_lifetime_admin() then
        return jsonb_build_object('ok', false, 'error', 'not_admin');
      end if;

      if v_handle = '' then
        return jsonb_build_object('ok', false, 'error', 'missing_handle');
      end if;

      if v_plan not in ('pro', 'vip', 'all') then
        return jsonb_build_object('ok', false, 'error', 'invalid_plan');
      end if;

      select * into v_profile
      from public.profiles
      where lower(replace(handle, '@', '')) = v_handle
         or lower(coalesce(username, '')) = v_handle
      limit 1;

      if not found then
        return jsonb_build_object('ok', false, 'error', 'user_not_found');
      end if;

      select * into v_existing
      from public.subscriptions
      where user_id = v_profile.id
      for update;

      if found then
        v_was_all := v_existing.is_lifetime
          and v_existing.status = 'active'
          and coalesce(v_existing.payment_verified, false) = true
          and v_existing.plan = 'all';
      end if;

      insert into public.subscriptions as s (
        user_id, plan, status, is_lifetime, payment_verified, granted_by, revoked_at, current_period_end, updated_at
      )
      values (
        v_profile.id, v_plan, 'active', true, true, 'drewmclawhorn3', null, null, now()
      )
      on conflict (user_id) do update set
        plan = excluded.plan,
        status = 'active',
        is_lifetime = true,
        payment_verified = true,
        granted_by = 'drewmclawhorn3',
        revoked_at = null,
        current_period_end = null,
        updated_at = now();

      if v_plan = 'all' and not v_was_all and to_regclass('public.user_coins') is not null then
        insert into public.user_coins as c (user_id, balance)
        values (v_profile.id, 1000)
        on conflict (user_id) do update set
          balance = c.balance + 1000,
          updated_at = now();
      end if;

      return jsonb_build_object(
        'ok', true,
        'user_id', v_profile.id,
        'handle', v_profile.handle,
        'plan', v_plan
      );
    end;
    $fn$;
  end if;
end
$$;

create or replace function public.my_lifetime_subscription()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.subscriptions;
  v_is_owner boolean := false;
begin
  if auth.uid() is null then
    return null;
  end if;

  if to_regclass('public.profiles') is not null then
    select exists (
      select 1
      from public.profiles
      where id = auth.uid()
        and (
          lower(replace(coalesce(handle, ''), '@', '')) = 'drewmclawhorn3'
          or lower(coalesce(username, '')) = 'drewmclawhorn3'
        )
    ) into v_is_owner;
  end if;

  if v_is_owner and to_regclass('public.subscriptions') is not null then
    insert into public.subscriptions (
      user_id, plan, status, is_lifetime, payment_verified, granted_by, revoked_at, current_period_end, updated_at
    )
    values (
      auth.uid(), 'all', 'active', true, true, 'drewmclawhorn3', null, null, now()
    )
    on conflict (user_id) do update set
      plan = 'all',
      status = 'active',
      is_lifetime = true,
      payment_verified = true,
      granted_by = 'drewmclawhorn3',
      revoked_at = null,
      current_period_end = null,
      updated_at = now()
    returning * into v_row;

    return jsonb_build_object(
      'plan', v_row.plan,
      'status', v_row.status,
      'is_lifetime', v_row.is_lifetime,
      'payment_verified', true,
      'granted_by', v_row.granted_by,
      'granted_at', v_row.created_at,
      'revoked_at', v_row.revoked_at
    );
  end if;

  if to_regclass('public.subscriptions') is null then
    return null;
  end if;

  select * into v_row
  from public.subscriptions
  where user_id = auth.uid()
  limit 1;

  if not found or v_row.plan = 'free' then
    return null;
  end if;

  if v_row.status = 'active' and coalesce(v_row.payment_verified, false) = false then
    return null;
  end if;

  return jsonb_build_object(
    'plan', v_row.plan,
    'status', v_row.status,
    'is_lifetime', v_row.is_lifetime,
    'payment_verified', coalesce(v_row.payment_verified, false),
    'granted_by', v_row.granted_by,
    'granted_at', v_row.created_at,
    'revoked_at', v_row.revoked_at
  );
end;
$$;

create or replace function public.my_offline_entitlement()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_plan text := null;
  v_video boolean := false;
  v_music boolean := false;
begin
  if v_uid is null then
    return jsonb_build_object('video', false, 'music', false, 'plan', null);
  end if;

  -- 1. Owner @drewmclawhorn3 only (never copied to other users).
  if to_regclass('public.profiles') is not null and exists (
    select 1 from public.profiles
    where id = v_uid
      and (
        lower(replace(coalesce(handle, ''), '@', '')) = 'drewmclawhorn3'
        or lower(coalesce(username, '')) = 'drewmclawhorn3'
      )
  ) then
    return jsonb_build_object('video', true, 'music', true, 'plan', 'all');
  end if;

  -- 2. Verified lifetime grant in public.subscriptions.
  if to_regclass('public.subscriptions') is not null then
    select s.plan into v_plan
    from public.subscriptions s
    where s.user_id = v_uid
      and s.status = 'active'
      and s.plan <> 'free'
      and (
        (s.is_lifetime = true and coalesce(s.payment_verified, false) = true)
        or (
          s.is_lifetime = false
          and s.plan <> 'all'
          and (s.current_period_end is null or s.current_period_end > now())
        )
      )
    limit 1;

    if v_plan = 'all' or v_plan = 'vip' then
      return jsonb_build_object('video', true, 'music', true, 'plan', v_plan);
    elsif v_plan in ('plus', 'pro') then
      return jsonb_build_object('video', true, 'music', false, 'plan', v_plan);
    end if;
  end if;

  -- 3. Account subscription in public.user_subscriptions (requires non-expired & payment_verified for 'all').
  select us.plan_id into v_plan
  from public.user_subscriptions us
  where us.user_id = v_uid
    and us.plan_id <> 'free'
    and coalesce(us.plan_status, us.status) in ('active', 'trialing')
    and (us.plan_id <> 'all' or coalesce(us.payment_verified, false) = true)
    and (us.expires_at is null or us.expires_at > now())
  limit 1;

  if v_plan is not null then
    v_video := v_plan in ('plus', 'pro', 'vip', 'all');
    v_music := v_plan in ('vip', 'all');
    return jsonb_build_object('video', v_video, 'music', v_music, 'plan', v_plan);
  end if;

  return jsonb_build_object('video', false, 'music', false, 'plan', null);
end;
$$;

revoke all on function public.my_lifetime_subscription() from public, anon;
revoke all on function public.my_offline_entitlement() from public, anon;
grant execute on function public.my_lifetime_subscription() to authenticated;
grant execute on function public.my_offline_entitlement() to authenticated;

notify pgrst, 'reload schema';
