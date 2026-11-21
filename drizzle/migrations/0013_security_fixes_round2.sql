-- Admin helpers: role table only
CREATE OR REPLACE FUNCTION public.is_codes_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ select public.has_role(auth.uid(), 'admin') $$;
CREATE OR REPLACE FUNCTION public.is_lifetime_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ select public.has_role(auth.uid(), 'admin') $$;
CREATE OR REPLACE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$ select auth.uid() is not null and public.has_role(auth.uid(), 'admin') $$;

-- No self-credit
CREATE OR REPLACE FUNCTION public.admin_credit_coins(_user_id uuid, _coins integer, _diamonds integer DEFAULT 0, _reason text DEFAULT NULL::text)
 RETURNS user_coins LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_row public.user_coins;
begin
  if auth.uid() is null then raise exception 'not_signed_in' using errcode = '42501'; end if;
  if not public.is_admin() then raise exception 'not_admin' using errcode = '42501'; end if;
  if _user_id is null then raise exception 'missing_user' using errcode = '22023'; end if;
  if _user_id = auth.uid() then raise exception 'cannot_credit_self' using errcode = '42501'; end if;
  if coalesce(_coins, 0) = 0 and coalesce(_diamonds, 0) = 0 then raise exception 'nothing_to_credit' using errcode = '22023'; end if;
  if coalesce(_coins, 0) < 0 or coalesce(_diamonds, 0) < 0 then raise exception 'negative_credit' using errcode = '22023'; end if;
  insert into public.user_coins (user_id, balance, diamonds, updated_at)
  values (_user_id, coalesce(_coins, 0), coalesce(_diamonds, 0), now())
  on conflict (user_id) do update
    set balance = public.user_coins.balance + coalesce(_coins, 0),
        diamonds = public.user_coins.diamonds + coalesce(_diamonds, 0),
        updated_at = now()
  returning * into v_row;
  begin
    insert into public.moderation_log (action)
    values ('admin_credit_coins user=' || _user_id::text || ' by=' || auth.uid()::text
      || ' coins=' || coalesce(_coins, 0)::text || ' diamonds=' || coalesce(_diamonds, 0)::text
      || ' reason=' || coalesce(_reason, ''));
  exception when others then null; end;
  return v_row;
end;
$function$;

-- Wallet: no direct client updates
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT policyname FROM pg_policies WHERE schemaname='public' AND tablename='user_coins' AND cmd IN ('UPDATE','ALL') LOOP
    EXECUTE format('DROP POLICY %I ON public.user_coins', r.policyname);
  END LOOP;
END $$;
REVOKE UPDATE, INSERT, DELETE ON public.user_coins FROM anon, authenticated;

-- Definer functions: no anonymous callers
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY[
    'public.check_creator_fund(uuid)','public.redeem_subscription_code(text)','public.record_video_view(uuid)',
    'public.ban_status_for_handle(text)','public.admin_coin_venmo_orders(integer)','public.admin_review_coin_venmo_order(uuid,text,text)',
    'public.admin_mark_payout_paid(uuid,text,text)','public.report_content(uuid,text,text,text)','public.admin_follower_payouts(integer)',
    'public.admin_payouts(integer)','public.admin_mark_creator_payout_paid(uuid,text)','public.admin_credit_coins(uuid,integer,integer,text)',
    'public.admin_set_subscription_code_active(text,boolean)','public.admin_search_users(text)','public.admin_revoke_lifetime(uuid)'] LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', f);
  END LOOP;
END $$;
-- Admin-only listings/updates: also block non-admin signed-in users at the grant level is not possible, they check has_role inside.

-- app_settings: singleton row public, app_status as invoker
DROP POLICY IF EXISTS "public read app_settings" ON public.app_settings;
CREATE POLICY "read app settings row" ON public.app_settings FOR SELECT TO anon, authenticated USING (id = 1);
ALTER FUNCTION public.app_status() SECURITY INVOKER;

-- beta_features: admin only
DROP POLICY IF EXISTS "public read beta_features" ON public.beta_features;

-- comments
DROP POLICY IF EXISTS "comments insertable" ON public.comments;
DROP POLICY IF EXISTS "comments readable" ON public.comments;
CREATE POLICY "comments insert own handle" ON public.comments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.handle = comments.username));
CREATE POLICY "comments on visible videos" ON public.comments FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.videos v WHERE v.id = comments.video_id));

-- follows / likes / full video likes: signed-in only
DROP POLICY IF EXISTS "follows readable" ON public.follows;
CREATE POLICY "follows readable signed in" ON public.follows FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "likes readable" ON public.likes;
DROP POLICY IF EXISTS "likes readable by all" ON public.likes;
CREATE POLICY "likes readable signed in" ON public.likes FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS "full video likes are viewable by everyone" ON public.full_video_likes;
CREATE POLICY "full video likes signed in" ON public.full_video_likes FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- full videos / comments
DROP POLICY IF EXISTS "full videos are public" ON public.full_videos;
DROP POLICY IF EXISTS "full_videos are viewable by everyone" ON public.full_videos;
CREATE POLICY "full videos ready or own" ON public.full_videos FOR SELECT TO anon, authenticated
  USING (status = 'ready' OR auth.uid() = user_id);
DROP POLICY IF EXISTS "full video comments are viewable by everyone" ON public.full_video_comments;
CREATE POLICY "full video comments on visible videos" ON public.full_video_comments FOR SELECT TO anon, authenticated
  USING (EXISTS (SELECT 1 FROM public.full_videos fv WHERE fv.id = full_video_comments.video_id));

-- live gifts
DROP POLICY IF EXISTS "Anyone can read gifts" ON public.live_gifts;
DROP POLICY IF EXISTS "Anyone can send gifts" ON public.live_gifts;
CREATE POLICY "gifts readable signed in" ON public.live_gifts FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
REVOKE INSERT, UPDATE, DELETE ON public.live_gifts FROM anon, authenticated;

-- marketplace
DROP POLICY IF EXISTS "Listings are public" ON public.marketplace_items;
CREATE POLICY "listings from non-banned sellers" ON public.marketplace_items FOR SELECT TO anon, authenticated
  USING (NOT public.is_banned_uid(user_id) OR auth.uid() = user_id);

-- muted words
DROP POLICY IF EXISTS "muted words readable" ON public.muted_words;
CREATE POLICY "muted words signed in" ON public.muted_words FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- profiles
DROP POLICY IF EXISTS "profiles readable" ON public.profiles;
CREATE POLICY "profiles of non-banned users" ON public.profiles FOR SELECT TO anon, authenticated
  USING (NOT public.is_banned_uid(id) OR auth.uid() = id OR public.has_role(auth.uid(), 'admin'));

-- sounds
DROP POLICY IF EXISTS "public read sounds" ON public.sounds;
CREATE POLICY "sounds from visible videos" ON public.sounds FOR SELECT TO anon, authenticated
  USING (original_video_id IS NULL OR auth.uid() = user_id
    OR EXISTS (SELECT 1 FROM public.videos v WHERE v.id = sounds.original_video_id));

-- videos
DROP POLICY IF EXISTS "anyone can read videos" ON public.videos;
DROP POLICY IF EXISTS "videos readable" ON public.videos;
DROP POLICY IF EXISTS "authenticated can post videos" ON public.videos;
CREATE POLICY "owners read own videos" ON public.videos FOR SELECT TO authenticated USING (auth.uid() = user_id);

-- storage
DROP POLICY IF EXISTS "signed-in users upload to videos bucket" ON storage.objects;
DROP POLICY IF EXISTS "public upload videos bucket" ON storage.objects;
CREATE POLICY "users upload own folder videos bucket" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'videos' AND (storage.foldername(name))[1] = auth.uid()::text);
DROP POLICY IF EXISTS "groups read" ON storage.objects;
DROP POLICY IF EXISTS "marketplace read" ON storage.objects;
DROP POLICY IF EXISTS "public read videos bucket" ON storage.objects;
DROP POLICY IF EXISTS "public read gifs bucket" ON storage.objects;
CREATE POLICY "signed in read media buckets" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id IN ('groups','marketplace','videos','gifs') AND auth.uid() IS NOT NULL);