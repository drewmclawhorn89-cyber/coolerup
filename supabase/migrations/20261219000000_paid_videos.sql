-- ============================================================================
-- Coolerup · Paid Videos
-- ============================================================================
-- Lets a creator charge for a single video, short form (the For You feed) or
-- long form (the Videos tab). Everything here is additive: the existing
-- `videos` and `full_videos` rows simply gain two nullable columns, and a video
-- with `is_paid = false` behaves exactly as it does today.
--
-- Money rules (matching the product spec):
--   creator gets 80% of the sale, Coolerup keeps 20%
--   100 coins = $0.50  ->  1 coin = half a cent
--   a purchase is permanent: one row per (video, buyer), so a viewer can never
--   be charged twice for the same video.
--
-- The client never sends an amount. It sends a video id and how it wants to
-- pay; the server reads `price_cents` off the row and does the split itself, so
-- a tampered client cannot buy a $4.99 video for a penny.
-- ============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. The two columns that turn a video into a paid video
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists is_paid boolean not null default false,
  add column if not exists price_cents integer;

alter table public.full_videos
  add column if not exists is_paid boolean not null default false,
  add column if not exists price_cents integer;

-- A paid video must carry a sane price. Free videos keep `price_cents` null so
-- there is exactly one way to express "free".
alter table public.videos
  drop constraint if exists videos_paid_price_check;
alter table public.videos
  add constraint videos_paid_price_check check (
    (is_paid = false and price_cents is null)
    or (is_paid = true and price_cents is not null and price_cents between 50 and 100000)
  );

alter table public.full_videos
  drop constraint if exists full_videos_paid_price_check;
alter table public.full_videos
  add constraint full_videos_paid_price_check check (
    (is_paid = false and price_cents is null)
    or (is_paid = true and price_cents is not null and price_cents between 50 and 100000)
  );

-- The feed filters paid rows in and out, so keep the lookup cheap.
create index if not exists videos_is_paid_idx on public.videos (is_paid) where is_paid = true;
create index if not exists full_videos_is_paid_idx on public.full_videos (is_paid) where is_paid = true;

-- ---------------------------------------------------------------------------
-- 2. Purchases
-- ---------------------------------------------------------------------------
-- `kind` says which table `video_id` points at, because a short-form video and
-- a long-form video can share a uuid by accident and must not unlock each other.
create table if not exists public.video_purchases (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null,
  kind text not null check (kind in ('short', 'full')),
  buyer_id uuid not null references auth.users (id) on delete cascade,
  creator_id uuid not null references auth.users (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  creator_cents integer not null check (creator_cents >= 0),
  platform_cents integer not null check (platform_cents >= 0),
  paid_with text not null check (paid_with in ('coins', 'card')),
  coins_spent integer not null default 0 check (coins_spent >= 0),
  created_at timestamptz not null default now(),
  -- The whole "don't charge twice" guarantee lives here.
  unique (video_id, kind, buyer_id)
);

create index if not exists video_purchases_buyer_idx
  on public.video_purchases (buyer_id, created_at desc);
create index if not exists video_purchases_creator_idx
  on public.video_purchases (creator_id, created_at desc);

alter table public.video_purchases enable row level security;

-- Buyers can see what they own; creators can see what they sold.
drop policy if exists "buyers read own purchases" on public.video_purchases;
create policy "buyers read own purchases" on public.video_purchases
  for select to authenticated
  using (auth.uid() = buyer_id);

drop policy if exists "creators read own sales" on public.video_purchases;
create policy "creators read own sales" on public.video_purchases
  for select to authenticated
  using (auth.uid() = creator_id);

drop policy if exists "admins read all purchases" on public.video_purchases;
create policy "admins read all purchases" on public.video_purchases
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- No insert/update/delete policy on purpose: rows are only ever written by
-- `purchase_paid_video()` below, which runs as definer and enforces the price.
grant select on public.video_purchases to authenticated;
grant all on public.video_purchases to service_role;

-- ---------------------------------------------------------------------------
-- 3. The revenue split, in one place
-- ---------------------------------------------------------------------------
-- 80 / 20, floored on the creator side so the platform can never round money
-- away from the person who made the video.
create or replace function public.paid_video_split(p_amount_cents integer)
returns table (creator_cents integer, platform_cents integer)
language sql
immutable
as $$
  select
    floor(greatest(0, p_amount_cents) * 0.8)::integer as creator_cents,
    (greatest(0, p_amount_cents) - floor(greatest(0, p_amount_cents) * 0.8)::integer)::integer
      as platform_cents;
$$;

-- ---------------------------------------------------------------------------
-- 4. Buying
-- ---------------------------------------------------------------------------
-- One transaction: check the video is really paid, check it isn't the buyer's
-- own video, check they don't already own it, take the money, write the
-- purchase, and pay the creator. Returns the purchase id.
--
-- Paying with coins debits `user_coins.balance`. Paying with card is settled by
-- Stripe before this is called; the row records that the money came from a card.
create or replace function public._record_paid_video_purchase(
  p_buyer uuid,
  p_video_id uuid,
  p_kind text,
  p_paid_with text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_buyer uuid := p_buyer;
  v_price integer;
  v_creator uuid;
  v_is_paid boolean;
  v_balance integer;
  v_coins integer := 0;
  v_split record;
  v_purchase_id uuid;
  v_existing uuid;
begin
  if v_buyer is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  if p_kind not in ('short', 'full') then
    return jsonb_build_object('ok', false, 'error', 'invalid_kind');
  end if;

  if p_paid_with not in ('coins', 'card') then
    return jsonb_build_object('ok', false, 'error', 'invalid_payment_method');
  end if;

  if p_kind = 'short' then
    select is_paid, price_cents, user_id
      into v_is_paid, v_price, v_creator
      from public.videos where id = p_video_id;
  else
    select is_paid, price_cents, user_id
      into v_is_paid, v_price, v_creator
      from public.full_videos where id = p_video_id;
  end if;

  if v_price is null then
    return jsonb_build_object('ok', false, 'error', 'video_not_found');
  end if;

  if v_is_paid is not true then
    return jsonb_build_object('ok', false, 'error', 'not_a_paid_video');
  end if;

  -- `videos.user_id` is nullable (legacy rows), and a sale has to have someone
  -- to pay. Refuse rather than fail on the user_coins primary key.
  if v_creator is null then
    return jsonb_build_object('ok', false, 'error', 'video_not_found');
  end if;

  if v_creator = v_buyer then
    return jsonb_build_object('ok', false, 'error', 'cannot_buy_own_video');
  end if;

  -- Already owned? Hand back the existing row instead of charging again.
  select id into v_existing
    from public.video_purchases
    where video_id = p_video_id and kind = p_kind and buyer_id = v_buyer;

  if v_existing is not null then
    return jsonb_build_object(
      'ok', true,
      'alreadyOwned', true,
      'purchaseId', v_existing,
      'amountCents', v_price
    );
  end if;

  if p_paid_with = 'coins' then
    -- 1 coin = half a cent, so a $0.99 video costs 198 coins.
    v_coins := ceil(v_price * 2.0)::integer;

    select balance into v_balance
      from public.user_coins
      where user_id = v_buyer
      for update;

    if v_balance is null then
      return jsonb_build_object('ok', false, 'error', 'no_wallet');
    end if;

    if v_balance < v_coins then
      return jsonb_build_object(
        'ok', false,
        'error', 'insufficient_coins',
        'needed', v_coins,
        'balance', v_balance
      );
    end if;

    update public.user_coins
      set balance = balance - v_coins,
          updated_at = now()
      where user_id = v_buyer;
  end if;

  select * into v_split from public.paid_video_split(v_price);

  insert into public.video_purchases (
    video_id, kind, buyer_id, creator_id,
    amount_cents, creator_cents, platform_cents, paid_with, coins_spent
  ) values (
    p_video_id, p_kind, v_buyer, v_creator,
    v_price, v_split.creator_cents, v_split.platform_cents, p_paid_with, v_coins
  )
  on conflict (video_id, kind, buyer_id) do nothing
  returning id into v_purchase_id;

  -- Lost a race with another tab: the other insert won, so undo nothing and
  -- report the purchase that already exists.
  if v_purchase_id is null then
    select id into v_existing
      from public.video_purchases
      where video_id = p_video_id and kind = p_kind and buyer_id = v_buyer;
    if p_paid_with = 'coins' then
      update public.user_coins
        set balance = balance + v_coins, updated_at = now()
        where user_id = v_buyer;
    end if;
    return jsonb_build_object(
      'ok', true,
      'alreadyOwned', true,
      'purchaseId', v_existing,
      'amountCents', v_price
    );
  end if;

  -- Pay the creator their 80%. Diamonds are the creator-side currency, and the
  -- existing wallet already shows diamonds as cash at $0.01 each.
  if v_split.creator_cents > 0 then
    insert into public.user_coins (user_id, balance, diamonds, total_earned)
    values (v_buyer, 0, 0, 0)
    on conflict (user_id) do nothing;

    insert into public.user_coins (user_id, balance, diamonds, total_earned)
    values (v_creator, 0, v_split.creator_cents, v_split.creator_cents)
    on conflict (user_id) do update
      set diamonds = public.user_coins.diamonds + excluded.diamonds,
          total_earned = public.user_coins.total_earned + excluded.total_earned,
          updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'alreadyOwned', false,
    'purchaseId', v_purchase_id,
    'amountCents', v_price,
    'creatorCents', v_split.creator_cents,
    'platformCents', v_split.platform_cents,
    'coinsSpent', v_coins
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 4b. The two entry points
-- ---------------------------------------------------------------------------
-- The client may only spend coins. Card money has to be captured by Stripe
-- first, so the card path is a separate service-role function that the server
-- calls after a successful charge. Without this split any authenticated user
-- could call `purchase_paid_video(..., 'card')` and unlock a video for free.
create or replace function public.purchase_paid_video(
  p_video_id uuid,
  p_kind text,
  p_paid_with text default 'coins'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_paid_with is distinct from 'coins' then
    return jsonb_build_object('ok', false, 'error', 'card_requires_checkout');
  end if;
  return public._record_paid_video_purchase(auth.uid(), p_video_id, p_kind, 'coins');
end;
$$;

grant execute on function public.purchase_paid_video(uuid, text, text) to authenticated;

-- Service role only: called by the server after Stripe captured the payment.
create or replace function public.grant_paid_video_purchase(
  p_buyer uuid,
  p_video_id uuid,
  p_kind text,
  p_payment_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_buyer is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;
  return public._record_paid_video_purchase(p_buyer, p_video_id, p_kind, 'card');
end;
$$;

revoke all on function public.grant_paid_video_purchase(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.grant_paid_video_purchase(uuid, uuid, text, text)
  to service_role;
revoke all on function public._record_paid_video_purchase(uuid, uuid, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. "Do I own this?" for the feed
-- ---------------------------------------------------------------------------
-- The feed needs this for a whole page of videos at once, so it takes arrays
-- and returns only the ids the viewer owns.
create or replace function public.my_paid_video_entitlements(
  p_short_ids uuid[] default '{}',
  p_full_ids uuid[] default '{}'
)
returns table (video_id uuid, kind text)
language sql
security definer
set search_path = public
stable
as $$
  select vp.video_id, vp.kind
    from public.video_purchases vp
    where vp.buyer_id = auth.uid()
      and (
        (vp.kind = 'short' and vp.video_id = any (p_short_ids))
        or (vp.kind = 'full' and vp.video_id = any (p_full_ids))
      );
$$;

grant execute on function public.my_paid_video_entitlements(uuid[], uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Earnings for the wallet / profile
-- ---------------------------------------------------------------------------
create or replace function public.my_paid_video_earnings()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user uuid := auth.uid();
  v_sales integer := 0;
  v_gross integer := 0;
  v_creator integer := 0;
  v_platform integer := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select count(*), coalesce(sum(amount_cents), 0),
         coalesce(sum(creator_cents), 0), coalesce(sum(platform_cents), 0)
    into v_sales, v_gross, v_creator, v_platform
    from public.video_purchases
    where creator_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'sales', v_sales,
    'grossCents', v_gross,
    'creatorCents', v_creator,
    'platformCents', v_platform
  );
end;
$$;

grant execute on function public.my_paid_video_earnings() to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The two profile shelves
-- ---------------------------------------------------------------------------
-- "My Paid Videos" is just a filter on the creator's own rows, so the existing
-- profile queries can ask for it. "Purchased Videos" needs a join, which is
-- this function: every purchase the viewer made, newest first, with the video
-- itself so the profile can render a thumbnail.
create or replace function public.my_purchased_videos(p_limit integer default 60)
returns table (
  purchase_id uuid,
  video_id uuid,
  kind text,
  amount_cents integer,
  created_at timestamptz,
  username text,
  caption text,
  video_url text,
  thumbnail_url text
)
language sql
security definer
set search_path = public
stable
as $$
  select vp.id,
         vp.video_id,
         vp.kind,
         vp.amount_cents,
         vp.created_at,
         coalesce(v.username, f.username) as username,
         coalesce(v.caption, f.title) as caption,
         coalesce(v.video_url, f.video_url) as video_url,
         f.thumbnail_url
    from public.video_purchases vp
    left join public.videos v
      on vp.kind = 'short' and v.id = vp.video_id
    left join public.full_videos f
      on vp.kind = 'full' and f.id = vp.video_id
    where vp.buyer_id = auth.uid()
    order by vp.created_at desc
    limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

grant execute on function public.my_purchased_videos(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Paid videos the viewer cannot play yet
-- ---------------------------------------------------------------------------
-- The feed needs to know, per row, whether to draw the lock. Rather than a
-- second round trip the client asks this once per page.
create or replace function public.paid_video_lock_state(
  p_short_ids uuid[] default '{}',
  p_full_ids uuid[] default '{}'
)
returns table (video_id uuid, kind text, price_cents integer, owned boolean)
language sql
security definer
set search_path = public
stable
as $$
  select v.id,
         'short'::text,
         v.price_cents,
         exists (
           select 1 from public.video_purchases vp
           where vp.video_id = v.id and vp.kind = 'short' and vp.buyer_id = auth.uid()
         )
    from public.videos v
    where v.is_paid = true and v.id = any (p_short_ids)
  union all
  select f.id,
         'full'::text,
         f.price_cents,
         exists (
           select 1 from public.video_purchases vp
           where vp.video_id = f.id and vp.kind = 'full' and vp.buyer_id = auth.uid()
         )
    from public.full_videos f
    where f.is_paid = true and f.id = any (p_full_ids);
$$;

grant execute on function public.paid_video_lock_state(uuid[], uuid[]) to authenticated;
