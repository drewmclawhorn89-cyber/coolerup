-- Align the TikTok-style payout system with the requested schema:
--
--   user_balance          user_id, diamonds, real_balance, total_earned
--   video_views           video_id, user_id, views
--   creator_fund_earnings id, user_id, video_id, views, earnings, created_at
--   live_gifts            ..., coins, diamonds
--   gift_claims           id, user_id, gift, coins
--   payouts               id, user_id, amount, method, status, created_at
--
-- The tables already exist from 20261112000000_tiktok_payouts.sql, so this
-- migration only adds the missing columns, backfills them, and switches the
-- creator fund from one milestone per account to one milestone per video
-- (which is what "Video @x got 10k views = $0.20" requires).
--
-- Money safety is unchanged: every payout is still guarded by a unique index,
-- so re-running this migration or re-checking the fund can never double-pay.

-- ---------------------------------------------------------------------------
-- 1. video_views.views
-- ---------------------------------------------------------------------------
-- One row in this table is one counted view, so `views` is 1 per row and
-- SUM(views) is the total. Keeping the per-viewer rows is what makes the
-- anti-refresh-farm unique index possible; the column exists so the table
-- matches the documented shape and so aggregates can be written as
-- `sum(views)`.
alter table public.video_views
  add column if not exists views integer not null default 1
    check (views >= 0);

create index if not exists video_views_video_id_idx
  on public.video_views (video_id);

-- ---------------------------------------------------------------------------
-- 2. creator_fund_earnings: per-video attribution
-- ---------------------------------------------------------------------------
alter table public.creator_fund_earnings
  add column if not exists video_id uuid references public.videos (id) on delete set null;

alter table public.creator_fund_earnings
  add column if not exists views integer not null default 0;

alter table public.creator_fund_earnings
  add column if not exists earnings numeric(10, 2) not null default 0.00;

-- `amount` was the original column; keep the two in lockstep so older reads
-- keep working.
update public.creator_fund_earnings
   set earnings = amount
 where earnings <> amount;

update public.creator_fund_earnings
   set views = milestone_views
 where views = 0;

-- The old rule was one milestone per account, ever. Per-video milestones need
-- a per-video key instead, but the account-wide rows that already exist must
-- stay unique so nobody is paid twice for the same milestone.
alter table public.creator_fund_earnings
  drop constraint if exists creator_fund_earnings_user_id_milestone_views_key;

create unique index if not exists creator_fund_earnings_legacy_idx
  on public.creator_fund_earnings (user_id, milestone_views)
  where video_id is null;

create unique index if not exists creator_fund_earnings_video_idx
  on public.creator_fund_earnings (user_id, video_id, milestone_views)
  where video_id is not null;

create index if not exists creator_fund_earnings_user_created_idx
  on public.creator_fund_earnings (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. live_gifts.diamonds
-- ---------------------------------------------------------------------------
alter table public.live_gifts
  add column if not exists diamonds integer not null default 0
    check (diamonds >= 0);

-- 100 coins = 50 diamonds, i.e. the 50/50 creator split.
update public.live_gifts
   set diamonds = coins / 2
 where diamonds = 0
   and coins > 0;

-- ---------------------------------------------------------------------------
-- 4. gift_claims.gift / gift_claims.coins
-- ---------------------------------------------------------------------------
alter table public.gift_claims
  add column if not exists gift text;

alter table public.gift_claims
  add column if not exists coins integer not null default 0;

update public.gift_claims gc
   set gift = coalesce(gc.gift, lg.gift_type),
       coins = case when gc.coins = 0 then lg.coins else gc.coins end
  from public.live_gifts lg
 where lg.id = gc.gift_id
   and (gc.gift is null or gc.coins = 0);

create index if not exists gift_claims_user_created_idx
  on public.gift_claims (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4b. paid-coin provenance
-- ---------------------------------------------------------------------------
-- Only coins the user actually bought may generate creator earnings; the free
-- starter coins must not. `paid_balance` tracks how many of a user's remaining
-- coins are backed by a purchase, and `send_live_gift` spends free coins first.
alter table public.user_coins
  add column if not exists paid_balance integer not null default 0
    check (paid_balance >= 0);

-- Best-effort backfill: a user can't have more paid coins left than they ever
-- recharged, nor more than their current balance.
update public.user_coins
   set paid_balance = least(balance, total_recharged)
 where paid_balance = 0
   and total_recharged > 0;

-- Keep `paid_balance` in step with purchases without touching the Stripe or
-- Venmo approval functions: any increase in `total_recharged` is new paid coin.
create or replace function public.track_paid_coins()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.paid_balance := least(new.balance, new.total_recharged);
  elsif new.total_recharged > old.total_recharged then
    new.paid_balance := coalesce(old.paid_balance, 0)
      + (new.total_recharged - old.total_recharged);
  end if;
  return new;
end;
$$;

drop trigger if exists user_coins_track_paid on public.user_coins;
create trigger user_coins_track_paid
  before insert or update on public.user_coins
  for each row execute function public.track_paid_coins();

-- ---------------------------------------------------------------------------
-- 5. send_live_gift: record diamonds on the gift and gift/coins on the claim
-- ---------------------------------------------------------------------------
create or replace function public.send_live_gift(
  p_live_id text,
  p_receiver_id uuid,
  p_gift_type text,
  p_coins integer,
  p_quantity integer default 1
)
returns table (gift_id uuid, balance integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender uuid := auth.uid();
  v_balance integer;
  v_paid_balance integer;
  v_free integer;
  v_from_free integer;
  v_from_paid integer;
  v_gift_id uuid;
  v_diamonds integer;
  v_amount numeric(10, 2);
begin
  if v_sender is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  if p_receiver_id is null or p_receiver_id = v_sender then
    raise exception 'invalid_receiver' using errcode = '22023';
  end if;
  if p_coins is null or p_coins <= 0 or p_coins > 100000 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 100 then
    raise exception 'invalid_quantity' using errcode = '22023';
  end if;

  -- Lock the sender's wallet so two gifts at once can't overdraw it.
  -- `uc.` qualification keeps the OUT parameter named `balance` from shadowing
  -- the column of the same name.
  select uc.balance, coalesce(uc.paid_balance, 0)
    into v_balance, v_paid_balance
    from public.user_coins uc
   where uc.user_id = v_sender
     for update;

  if v_balance is null or v_balance < p_coins then
    raise exception 'insufficient_coins' using errcode = 'P0001';
  end if;

  -- Spend free starter coins first, so only purchased coins ever pay out.
  v_free := greatest(v_balance - v_paid_balance, 0);
  v_from_free := least(v_free, p_coins);
  v_from_paid := p_coins - v_from_free;

  update public.user_coins as uc
     set balance = uc.balance - p_coins,
         paid_balance = greatest(coalesce(uc.paid_balance, 0) - v_from_paid, 0),
         total_spent = uc.total_spent + p_coins,
         updated_at = now()
   where uc.user_id = v_sender
  returning uc.balance into v_balance;

  -- 100 paid coins = 50 diamonds, i.e. the 50/50 creator split. Free coins
  -- still send the gift, they just don't mint diamonds.
  v_diamonds := v_from_paid / 2;
  v_amount := round(v_diamonds * 0.01, 2);

  insert into public.live_gifts (
    live_id, sender_id, receiver_id, gift_type, coins, quantity, diamonds
  )
  values (
    p_live_id, v_sender, p_receiver_id, p_gift_type, p_coins, p_quantity, v_diamonds
  )
  returning id into v_gift_id;

  -- Legacy wallet, kept in sync so the existing LIVE UI is untouched.
  insert into public.user_coins as uc (user_id, balance, total_earned, diamonds)
  values (p_receiver_id, 0, p_coins, v_diamonds)
  on conflict (user_id) do update
    set total_earned = uc.total_earned + excluded.total_earned,
        diamonds = uc.diamonds + excluded.diamonds,
        updated_at = now();

  -- New earnings wallet: diamonds + lifetime USD value.
  insert into public.user_balance as ub (user_id, diamonds, total_earned)
  values (p_receiver_id, v_diamonds, v_amount)
  on conflict (user_id) do update
    set diamonds = ub.diamonds + excluded.diamonds,
        total_earned = ub.total_earned + excluded.total_earned,
        updated_at = now();

  -- Ledger row. `gift_id` is unique, so a retry can never double-credit.
  insert into public.gift_claims (gift_id, user_id, diamonds, amount, gift, coins)
  values (v_gift_id, p_receiver_id, v_diamonds, v_amount, p_gift_type, p_coins)
  on conflict (gift_id) do nothing;

  return query select v_gift_id, v_balance;
end;
$$;

revoke all on function public.send_live_gift(text, uuid, text, integer, integer) from public;
grant execute on function public.send_live_gift(text, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. record_video_view: write the `views` column explicitly
-- ---------------------------------------------------------------------------
create or replace function public.record_video_view(p_video_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_viewer uuid := auth.uid();
  v_creator uuid;
  v_handle text;
begin
  if v_viewer is null then
    return jsonb_build_object('ok', false, 'counted', false, 'reason', 'not_signed_in');
  end if;

  select v.user_id, v.username into v_creator, v_handle
    from public.videos v
   where v.id = p_video_id;

  if v_creator is null and v_handle is not null then
    select p.id into v_creator from public.profiles p where p.handle = v_handle;
  end if;

  if v_creator is null then
    return jsonb_build_object('ok', false, 'counted', false, 'reason', 'unknown_video');
  end if;

  -- Self-views never pay.
  if v_creator = v_viewer then
    return jsonb_build_object('ok', false, 'counted', false, 'reason', 'self_view');
  end if;

  insert into public.video_views (video_id, user_id, viewer_id, views)
  values (p_video_id, v_creator, v_viewer, 1)
  on conflict do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'duplicate');
  end if;

  return jsonb_build_object('ok', true, 'counted', true);
end;
$$;

revoke all on function public.record_video_view(uuid) from public;
grant execute on function public.record_video_view(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. check_creator_fund: pay milestones per video
-- ---------------------------------------------------------------------------
create or replace function public.check_creator_fund(p_user_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := coalesce(p_user_id, auth.uid());
  v_handle text;
  v_followers integer := 0;
  v_views30 integer := 0;
  v_total_views integer := 0;
  v_qualified boolean := false;
  v_video record;
  v_milestone record;
  v_awarded jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '42501';
  end if;
  -- A user may only check their own fund; admins may check anyone.
  if p_user_id is not null and p_user_id <> auth.uid() and not public.coin_admin_ok() then
    raise exception 'not_admin' using errcode = '42501';
  end if;

  select handle into v_handle from public.profiles where id = v_uid;

  select count(*) into v_followers
    from public.follows
   where following_username = v_handle;

  select coalesce(sum(vv.views), 0) into v_views30
    from public.video_views vv
   where vv.user_id = v_uid
     and vv.viewer_id is not null
     and vv.created_at > now() - interval '30 days';

  select coalesce(sum(vv.views), 0) into v_total_views
    from public.video_views vv
   where vv.user_id = v_uid
     and vv.viewer_id is not null;

  -- Qualification: 10 followers and 10k views in the last 30 days.
  v_qualified := v_followers >= 10 and v_views30 >= 10000;

  if v_qualified then
    for v_video in
      select v.id,
             coalesce((
               select sum(vv.views)
                 from public.video_views vv
                where vv.video_id = v.id
                  and vv.viewer_id is not null
             ), 0)::integer as views
        from public.videos v
       where v.user_id = v_uid
          or (v.user_id is null and v.username = v_handle)
    loop
      for v_milestone in
        select * from (values
          (1000, 0.02::numeric),
          (10000, 0.20::numeric),
          (100000, 2.00::numeric),
          (1000000, 20.00::numeric)
        ) as t(views, amount)
      loop
        if v_video.views < v_milestone.views then
          continue;
        end if;

        -- If this milestone was already paid account-wide before per-video
        -- attribution existed, do not pay it a second time.
        if exists (
          select 1
            from public.creator_fund_earnings cf
           where cf.user_id = v_uid
             and cf.milestone_views = v_milestone.views
             and cf.video_id is null
        ) then
          continue;
        end if;

        insert into public.creator_fund_earnings (
          user_id, video_id, milestone_views, views, earnings, amount
        )
        values (
          v_uid, v_video.id, v_milestone.views, v_video.views,
          v_milestone.amount, v_milestone.amount
        )
        on conflict (user_id, video_id, milestone_views) where video_id is not null
        do nothing;

        if found then
          update public.user_balance
             set real_balance = real_balance + v_milestone.amount,
                 total_earned = total_earned + v_milestone.amount,
                 updated_at = now()
           where user_id = v_uid;

          v_awarded := v_awarded || jsonb_build_object(
            'videoId', v_video.id,
            'views', v_milestone.views,
            'amount', v_milestone.amount
          );
        end if;
      end loop;
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'qualified', v_qualified,
    'followers', v_followers,
    'views30d', v_views30,
    'totalViews', v_total_views,
    'awarded', v_awarded
  );
end;
$$;

revoke all on function public.check_creator_fund(uuid) from public;
grant execute on function public.check_creator_fund(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. my_creator_fund: return per-video earnings with captions
-- ---------------------------------------------------------------------------
create or replace function public.my_creator_fund()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_handle text;
  v_followers integer := 0;
  v_views30 integer := 0;
  v_total_views integer := 0;
  v_qualified boolean := false;
  v_earned numeric(10, 2) := 0;
  v_rows jsonb;
  v_videos jsonb;
  v_next integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select handle into v_handle from public.profiles where id = v_uid;

  select count(*) into v_followers from public.follows where following_username = v_handle;

  select coalesce(sum(vv.views), 0) into v_views30
    from public.video_views vv
   where vv.user_id = v_uid and vv.viewer_id is not null
     and vv.created_at > now() - interval '30 days';

  select coalesce(sum(vv.views), 0) into v_total_views
    from public.video_views vv
   where vv.user_id = v_uid and vv.viewer_id is not null;

  v_qualified := v_followers >= 10 and v_views30 >= 10000;

  select coalesce(sum(cf.earnings), 0) into v_earned
    from public.creator_fund_earnings cf
   where cf.user_id = v_uid;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select cf.id,
             cf.video_id,
             cf.milestone_views,
             cf.views,
             cf.earnings,
             cf.amount,
             cf.created_at,
             v.caption,
             v.username as video_username
        from public.creator_fund_earnings cf
        left join public.videos v on v.id = cf.video_id
       where cf.user_id = v_uid
       order by cf.created_at desc
       limit 50
    ) t;

  -- Per-video totals, so the dashboard can say
  -- "Video @x got 10k views = $0.20".
  select coalesce(jsonb_agg(row_to_json(t) order by t.views desc), '[]'::jsonb)
    into v_videos
    from (
      select v.id as video_id,
             v.caption,
             v.username as video_username,
             coalesce((
               select sum(vv.views)
                 from public.video_views vv
                where vv.video_id = v.id and vv.viewer_id is not null
             ), 0)::integer as views,
             coalesce((
               select sum(cf.earnings)
                 from public.creator_fund_earnings cf
                where cf.video_id = v.id
             ), 0)::numeric(10, 2) as earnings
        from public.videos v
       where v.user_id = v_uid
          or (v.user_id is null and v.username = v_handle)
       order by views desc
       limit 50
    ) t;

  -- The next milestone the creator has not been paid for yet.
  select min(m.views) into v_next
    from (values (1000), (10000), (100000), (1000000)) as m(views)
   where m.views > coalesce(
     (select max(cf.milestone_views) from public.creator_fund_earnings cf where cf.user_id = v_uid),
     0
   );

  return jsonb_build_object(
    'ok', true,
    'qualified', v_qualified,
    'followers', v_followers,
    'views30d', v_views30,
    'totalViews', v_total_views,
    'earned', v_earned,
    'nextMilestone', v_next,
    'earnings', v_rows,
    'videos', v_videos
  );
end;
$$;

revoke all on function public.my_creator_fund() from public;
grant execute on function public.my_creator_fund() to authenticated;

-- ---------------------------------------------------------------------------
-- 9. my_gift_earnings: expose gift + coins columns
-- ---------------------------------------------------------------------------
create or replace function public.my_gift_earnings(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select gc.id,
             gc.gift_id,
             gc.gift,
             gc.coins,
             gc.diamonds,
             gc.amount,
             gc.created_at,
             lg.gift_type,
             lg.quantity,
             lg.live_id,
             p.handle as sender_username,
             p.display_name as sender_display_name,
             p.avatar_url as sender_avatar_url
        from public.gift_claims gc
        join public.live_gifts lg on lg.id = gc.gift_id
        left join public.profiles p on p.id = lg.sender_id
       where gc.user_id = v_uid
       order by gc.created_at desc
       limit v_limit
    ) t;

  return jsonb_build_object('ok', true, 'gifts', v_rows);
end;
$$;

revoke all on function public.my_gift_earnings(integer) from public;
grant execute on function public.my_gift_earnings(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. my_earnings_summary: read `earnings` (falls back to `amount`)
-- ---------------------------------------------------------------------------
create or replace function public.my_earnings_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_gift_diamonds integer := 0;
  v_gift_usd numeric(10, 2) := 0;
  v_fund_usd numeric(10, 2) := 0;
  v_follow_usd numeric(10, 2) := 0;
  v_diamonds integer := 0;
  v_real numeric(10, 2) := 0;
  v_earned numeric(10, 2) := 0;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_signed_in');
  end if;

  select coalesce(sum(gc.diamonds), 0), coalesce(sum(gc.amount), 0)
    into v_gift_diamonds, v_gift_usd
    from public.gift_claims gc
   where gc.user_id = v_uid;

  select coalesce(sum(cf.earnings), 0) into v_fund_usd
    from public.creator_fund_earnings cf
   where cf.user_id = v_uid;

  -- follower_rewards ships in its own migration; guard so this works either way.
  if to_regclass('public.follower_rewards') is not null then
    execute 'select coalesce(sum(fr.reward_amount), 0) from public.follower_rewards fr where fr.user_id = $1'
      into v_follow_usd using v_uid;
  end if;

  select coalesce(ub.diamonds, 0), coalesce(ub.real_balance, 0), coalesce(ub.total_earned, 0)
    into v_diamonds, v_real, v_earned
    from public.user_balance ub
   where ub.user_id = v_uid;

  return jsonb_build_object(
    'ok', true,
    'giftDiamonds', v_gift_diamonds,
    'giftUsd', v_gift_usd,
    'creatorFundUsd', v_fund_usd,
    'followerRewardUsd', v_follow_usd,
    'diamonds', v_diamonds,
    'realBalance', v_real,
    'totalEarned', v_earned,
    'cashable', round(v_real + v_diamonds * 0.01, 2)
  );
end;
$$;

revoke all on function public.my_earnings_summary() from public;
grant execute on function public.my_earnings_summary() to authenticated;
