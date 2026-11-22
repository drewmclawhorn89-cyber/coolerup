-- Always-on safety enforcement. No external AI calls or recurring billing.
create or replace function public.is_owner_uid(_uid uuid)
returns boolean language sql stable security definer set search_path=public as $$
  select _uid = 'c4ea818d-bb74-4134-a080-232b3e6f4fc8'::uuid
    and public.has_role(_uid,'admin');
$$;
create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path=public as $$
  select public.is_owner_uid(auth.uid());
$$;
revoke all on function public.is_owner_uid(uuid),public.is_owner() from public,anon;
grant execute on function public.is_owner_uid(uuid),public.is_owner() to authenticated,service_role;
create or replace function public.safety_classify(_text text, _scope text default 'any')
returns text
language plpgsql
immutable
as $$
declare
  n text;
  raw text := coalesce(_text, '');
begin
  if btrim(raw) = '' then
    return null;
  end if;
  n := public.safety_normalize(raw);

  -- Threats of violence.
  if n ~ (' (i will kill|i ll kill|im gonna kill|i m gonna kill|i will hurt|i ll hurt|'
       || 'i will find you|i know where you live|watch your back|you re dead|youre dead|'
       || 'ur dead|you are dead|i will shoot|i ll shoot|i will stab|i ll stab|'
       || 'bomb your|i will rape|i ll rape|rape you|beat you up|jump you|'
       || 'hunt you down|come for you|put you in the ground|slit your throat|'
       || 'break your neck|smash your face) ') then
    return 'threat';
  end if;

  -- Explicit sexual content.
  if n ~ (' (porn|porno|pornhub|xvideos|xhamster|onlyfans|only fans|nudes|naked|'
       || 'sexting|sextape|blowjob|handjob|rimjob|cumshot|jizz|creampie|dildo|'
       || 'vibrator|orgy|threesome|hentai|nsfw|milf|striptease|strip tease|camgirl|'
       || 'escort|send nudes|nude pics|nude selfie|fuck me|suck my|jerking off|'
       || 'masturbat|erotic|fetish|bdsm|pussy|dick pic|dick pics|cock pic|boobs|'
       || 'titties|horny|sext|sex tape|sex video|sex vid|nude video|xxx video|'
       || 'adult content|porn video|squirting|orgasm|clit|penis|vagina|anus|'
       || 'nipples|stripper|strip club|webcam sex|snap for nudes|kik for nudes|'
       || 'trade nudes) ') then
    return 'sexual';
  end if;

  -- Bullying, hate and dehumanising language.
  if n ~ (' (retard|retarded|spastic|mongoloid|tranny|faggot|fag|dyke|nigger|nigga|'
       || 'coon|chink|gook|spic|wetback|kike|paki|raghead|towelhead|sandnigger|'
       || 'beaner|cripple|fatass|fat ass|lardass|ugly bitch|worthless|kill yourself|'
       || 'kys|go die|nobody loves you|no one loves you|you should die|subhuman|'
       || 'vermin|freak|loser|waste of space|waste of air|kill urself|end yourself|'
       || 'drink bleach|idiot|moron|imbecile|dumbass|dumb ass|dumb bitch|'
       || 'stupid bitch|bitch|bitches|son of a bitch|bastard|whore|whores|slut|'
       || 'sluts|skank|thot|cunt|prick|douche|douchebag|scumbag|trash human|'
       || 'human trash|pathetic|shut up|nobody cares|no one cares|nobody asked|'
       || 'no one asked|nobody likes you|no one likes you|everyone hates you|'
       || 'you have no friends|youre worthless|you are worthless|youre nothing|'
       || 'you are nothing|youre a joke|you are a joke|ugliest|disgusting|'
       || 'go away forever|hope you die|unalive yourself|off yourself|hang yourself|'
       || 'go hang|slit your wrists|cut yourself|you should be dead|better off dead|'
       || 'no one would miss you|nobody would miss you|neck yourself) ') then
    return 'bullying';
  end if;

  -- Passwords, card numbers, SSNs, phone numbers, home addresses.
  if true then
    if raw ~* '\m(?:my|the|your)?\s*(?:password|passcode|pass word|login|log in|pin)\s*(?:is|:|=)\s*\S+'
       or raw ~* '\m(?:here(?:''s| is)|send me|text me|dm me)\s+(?:my\s+)?(?:password|login|pin)\M'
       or raw ~ '\m\d{3}-\d{2}-\d{4}\M'
       or raw ~ '\m(?:\d[ -]*?){13,16}\M'
       or raw ~ '\m(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\M'
       or raw ~* '\m(?:my|home|street)\s+address\s*(?:is|:)\s*\d+\s+\S+'
       or raw ~* '\m\d{1,5}\s+[A-Za-z0-9.''-]+(?:\s+[A-Za-z0-9.''-]+){0,3}\s+(?:street|st|avenue|ave|road|rd|lane|ln|drive|dr|boulevard|blvd)\M'
    then
      return 'pii';
    end if;
  end if;

  -- Fake accounts: claiming to be Coolerup staff, or baiting people into a
  -- "verification" that asks for a password. Only strong signals count; a new
  -- account with few followers is not a fake account.
  if _scope in ('any', 'profile') then
    if n ~ (' (coolerup support|coolerup admin|coolerup official|coolerup team|'
         || 'coolerup mod|coolerup moderator|coolerup help|coolerup security|'
         || 'coolerup staff|coolerup verify|coolerup verification|'
         || 'loop support|loop admin|loop official|loop team|loop mod|'
         || 'loop moderator|loop help|loop security|loop staff) ')
       or raw ~* '\m(?:dm me to get verified|get verified here|free verification|verify your account here|send your password|i can get you verified)\M'
       or raw ~* '\m(?:i am|i''m|im|we are|official)\M[^.!?]{0,24}\m(?:coolerup|loop)\M[^.!?]{0,24}\m(?:admin|support|official|team|moderator|staff|security)\M'
    then
      return 'fake';
    end if;
  end if;

  -- Spam and scams.
  if _scope <> 'profile' then
    if n ~ (' (follow for follow|f4f|l4l|follow back|follow4follow|free followers|'
         || 'free likes|free coins|free diamonds|cash app|cashapp|venmo me|'
         || 'paypal me|send money|dm me to earn|dm for promo|click the link|'
         || 'click here to win|you have won|you ve won|claim your prize|'
         || 'crypto giveaway|bitcoin giveaway|double your|make money fast|'
         || 'work from home|investment opportunity|guaranteed profit|telegram me|'
         || 'whatsapp me|buy followers|cheap followers|followers for sale|'
         || 'selling followers|get followers|gain followers|real followers|'
         || 'sub for sub|sub4sub|like for like|like4like|comment for comment|'
         || 'earn money online|passive income|financial freedom|get rich quick|'
         || 'click my link|promo link|promo available|advertising space|'
         || 'dm for collab|dm for price|dm for details|serious buyers only|'
         || 'limited offer|act fast|first 100 people) ')
       or (select count(*) from regexp_matches(raw, 'https?://|www\.', 'gi')) >= 3
       or raw ~ '(.)\1{6,}'
    then
      return 'spam';
    end if;
  end if;

  return null;
end
$$;
CREATE OR REPLACE FUNCTION public.auto_moderate(p_user_id uuid, p_username text, p_kind text, p_reason text, p_content_type text DEFAULT NULL::text, p_content_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  row_strike public.user_strikes%rowtype;
  new_count integer;
  action text;
  muted timestamptz;
  permanent boolean := false;
  deleted boolean := false;
  message text;
  target_email text;
  target_phone text;
  excerpt text;
  dev record;
begin
  if p_kind not in ('sexual','bullying','threat','pii','fake','spam','other') then
    return jsonb_build_object('ok',false,'error','invalid_kind');
  end if;
  if p_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'no_user');
  end if;

  if auth.uid() is not null
     and p_user_id <> auth.uid()
     and not public.has_role(auth.uid(), 'admin') then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  select coalesce(handle,p_username) into p_username from public.profiles where id=p_user_id;
  -- Never auto-ban the owner or an admin.
  if public.is_owner_uid(p_user_id) then
    return jsonb_build_object('ok', false, 'error', 'target_is_owner', 'strike', 0);
  end if;
  if public.has_role(p_user_id, 'admin') then
    return jsonb_build_object('ok', false, 'error', 'target_is_admin', 'strike', 0);
  end if;

  -- One account's concurrent violations cannot lose or duplicate strikes.
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));
  if p_content_id is not null and exists (
    select 1 from public.moderation_log where user_id = p_user_id
      and content_id = p_content_id and content_type = p_content_type and auto
      and strike_count > 0
  ) then
    select * into row_strike from public.user_strikes where user_id=p_user_id;
    return jsonb_build_object('ok',true,'strike',row_strike.strike_count,
      'action',case when row_strike.is_permanent then 'ban' when row_strike.muted_until>now() then 'mute' else 'warn' end,
      'permanent',row_strike.is_permanent,'muted_until',row_strike.muted_until,'deleted',true,
      'message','This content has already been moderated');
  end if;
  select * into row_strike from public.user_strikes where user_id = p_user_id;

  if row_strike.is_permanent then
    return jsonb_build_object(
      'ok', true,
      'strike', 3,
      'action', 'banned',
      'permanent', true,
      'message', 'Your account is permanently banned',
      'deleted', false
    );
  end if;

  -- Every kind climbs the same ladder: 1 warning, 2 mute, 3 ban.
  new_count := coalesce(row_strike.strike_count, 0) + 1;
  if new_count > 3 then new_count := 3; end if;

  -- Capture an excerpt before deleting so the log can show what was removed.
  if p_content_id is not null then
    if p_content_type = 'comment' then
      begin
        select left(coalesce(body, ''), 280) into excerpt
          from public.comments where id = p_content_id;
      exception when others then
        excerpt := null;
      end;
    elsif p_content_type = 'video' then
      begin
        select left(coalesce(caption, ''), 280) into excerpt
          from public.videos where id = p_content_id;
      exception when others then
        excerpt := null;
      end;
    end if;
  end if;

  -- Support all write surfaces, not just short videos and short comments.
  if p_content_id is not null then
    if p_content_type = 'full_video' then
      select left(title || ' ' || description,280) into excerpt from public.full_videos where id=p_content_id;
      delete from public.full_videos where id=p_content_id;
      deleted := found;
    elsif p_content_type = 'full_comment' then
      select left(body,280) into excerpt from public.full_video_comments where id=p_content_id;
      delete from public.full_video_comments where id=p_content_id;
      deleted := found;
    elsif p_content_type = 'message' then
      select left(message,280) into excerpt from public.direct_messages where id=p_content_id;
      delete from public.direct_messages where id=p_content_id;
      deleted := found;
    elsif p_content_type = 'legacy_message' then
      select left(message,280) into excerpt from public.messages where id=p_content_id;
      delete from public.messages where id=p_content_id;
      deleted := found;
    elsif p_content_type = 'profile' then
      select left(coalesce(bio,'') || ' ' || coalesce(display_name,''),280) into excerpt from public.profiles where id=p_user_id;
      update public.profiles set bio='', display_name=handle where id=p_user_id;
      deleted := found;
    elsif p_content_type = 'profile_pic' then
      update public.profiles set avatar_url=null where id=p_user_id;
      deleted := found;
    end if;
  end if;
  -- Never retain passwords or personal information in the audit excerpt.
  if p_kind = 'pii' then excerpt := '[Personal information redacted]'; end if;
  -- Remove the offending content on every strike.
  if p_content_id is not null then
    if p_content_type = 'comment' then
      begin
        delete from public.comments where id = p_content_id;
        deleted := true;
      exception when others then
        begin
          update public.comments set body = '[removed by Coolerup]' where id = p_content_id;
          deleted := true;
        exception when others then
          deleted := false;
        end;
      end;
    elsif p_content_type = 'video' then
      begin
        delete from public.videos where id = p_content_id;
        deleted := true;
      exception when others then
        begin
          update public.videos set hidden = true, hidden_reason = p_reason where id = p_content_id;
          deleted := true;
        exception when others then
          deleted := false;
        end;
      end;
    end if;
  end if;

  if new_count = 1 then
    action := 'warn';
    message := 'Warning 1/3 — This breaks Coolerup rules';
  elsif new_count = 2 then
    action := 'mute';
    muted := now() + interval '24 hours';
    message := 'Warning 2/3 — This breaks Coolerup rules. You are muted for 24 hours.';
  else
    action := 'ban';
    permanent := true;
    message := 'Warning 3/3 — This breaks Coolerup rules. Your account is permanently banned.';
  end if;

  insert into public.user_strikes as us (
    user_id, username, strike_count, last_reason, last_kind,
    last_content_type, last_content_id, muted_until, banned_at, is_permanent, updated_at
  )
  values (
    p_user_id, coalesce(p_username, 'unknown'), new_count, p_reason, p_kind,
    p_content_type, p_content_id, muted, case when permanent then now() else null end,
    permanent, now()
  )
  on conflict (user_id) do update
    set username = excluded.username,
        strike_count = excluded.strike_count,
        last_reason = excluded.last_reason,
        last_kind = excluded.last_kind,
        last_content_type = excluded.last_content_type,
        last_content_id = excluded.last_content_id,
        muted_until = coalesce(excluded.muted_until, public.user_strikes.muted_until),
        banned_at = coalesce(excluded.banned_at, public.user_strikes.banned_at),
        is_permanent = public.user_strikes.is_permanent or excluded.is_permanent,
        updated_at = now();

  -- Audit trail (what the AI Bot Logs screen reads).
  insert into public.moderation_log (
    action, actor, auto, reason, username, user_id,
    is_permanent, expires_at, window_hours,
    kind, content_type, content_id, content_excerpt, strike_count
  )
  values (
    action, 'Coolerup Safety Bot', true, p_reason, coalesce(p_username, 'unknown'), p_user_id,
    permanent, muted, case when muted is null then null else 24 end,
    p_kind, p_content_type, p_content_id, excerpt, new_count
  );

  if permanent then
    insert into public.banned_users (
      username, user_id, reason, kind, is_permanent, auto, banned_by, expires_at
    )
    select
      coalesce(p_username, 'unknown'), p_user_id, p_reason, 'ban', true, true, 'Coolerup Safety Bot', null
    where not exists (
      select 1 from public.banned_users b
      where b.user_id = p_user_id
         or lower(btrim(b.username)) = lower(btrim(coalesce(p_username, '')))
    );

    -- Burn email / phone / every device so a new account can't be made.
    begin
      select u.email, u.phone into target_email, target_phone
      from auth.users u where u.id = p_user_id;
    exception when others then
      target_email := null;
      target_phone := null;
    end;

    perform public.ban_identity('email', target_email, p_reason, p_user_id, p_username);
    perform public.ban_identity('phone', target_phone, p_reason, p_user_id, p_username);

    for dev in select device_id from public.user_devices where user_id = p_user_id loop
      perform public.ban_identity('device', dev.device_id, p_reason, p_user_id, p_username);
    end loop;
  end if;

  return jsonb_build_object(
    'ok', true,
    'strike', new_count,
    'action', action,
    'permanent', permanent,
    'muted_until', muted,
    'deleted', deleted,
    'message', message
  );
end;
$function$;

revoke all on function public.auto_moderate(uuid,text,text,text,text,uuid) from public,anon;
grant execute on function public.auto_moderate(uuid,text,text,text,text,uuid) to authenticated,service_role;

-- Runs on every insert/edit, including direct API writes, when nobody has the app open.
create or replace function public.safety_write_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  actor uuid;
  handle text;
  payload jsonb := to_jsonb(new);
begin
  if pg_trigger_depth()>1 then return new; end if;
  actor := coalesce(auth.uid(),nullif(payload->>'user_id','')::uuid,
    nullif(payload->>'from_id','')::uuid,nullif(payload->>'sender_id','')::uuid);
  if tg_table_name='profiles' then actor:=new.id; end if;
  if actor is null then
    select id into actor from public.profiles where lower(handle)=lower(coalesce(payload->>'username',payload->>'from_username'));
  end if;
  if actor is null or public.is_owner_uid(actor) then return new; end if;
  select p.handle into handle from public.profiles p where p.id=actor;
  if exists(select 1 from public.user_strikes where user_id=actor
    and (is_permanent or muted_until>now())) then
    -- Cancel, rather than raise: strike and removal transactions must survive.
    return null;
  end if;
  return new;
end;
$$;

create or replace function public.safety_review_write()
returns trigger language plpgsql security definer set search_path=public as $$
declare
  payload jsonb:=to_jsonb(new);
  actor uuid;
  handle text;
  content text;
  kind text;
  surface text;
begin
  if pg_trigger_depth()>1 then return new; end if;
  actor:=coalesce(auth.uid(),nullif(payload->>'user_id','')::uuid,
    nullif(payload->>'from_id','')::uuid,nullif(payload->>'sender_id','')::uuid);
  if tg_table_name='profiles' then actor:=new.id; end if;
  if actor is null then
    select p.id into actor from public.profiles p where lower(p.handle)=lower(coalesce(payload->>'username',payload->>'from_username'));
  end if;
  if actor is null or public.is_owner_uid(actor) or public.has_role(actor,'admin') then return new; end if;
  select p.handle into handle from public.profiles p where p.id=actor;
  case tg_table_name
    when 'videos' then content:=new.caption; surface:='video';
    when 'full_videos' then content:=new.title || ' ' || new.description; surface:='full_video';
    when 'comments' then content:=new.body; surface:='comment';
    when 'full_video_comments' then content:=new.body; surface:='full_comment';
    when 'direct_messages' then content:=new.message; surface:='message';
    when 'messages' then content:=new.message; surface:='legacy_message';
    when 'profiles' then content:=coalesce(new.display_name,'') || ' ' || coalesce(new.bio,''); surface:='profile';
    else return new;
  end case;
  kind:=public.safety_classify(content,case when surface='profile' then 'profile' else 'any' end);
  if kind is not null then
    perform public.auto_moderate(actor,handle,kind,public.safety_reason(kind),surface,new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.safety_write_guard(),public.safety_review_write() from public,anon,authenticated;
grant execute on function public.safety_write_guard(),public.safety_review_write() to service_role;

-- Install explicitly; previous helper functions existed but their triggers did not.
do $$
declare t text; cols text;
begin
  foreach t in array array['videos','full_videos','comments','full_video_comments','direct_messages','messages','profiles'] loop
    cols:=case t when 'videos' then 'caption,video_url' when 'full_videos' then 'title,description,video_url'
      when 'profiles' then 'bio,display_name,avatar_url' when 'comments' then 'body'
      when 'full_video_comments' then 'body' else 'message' end;
    execute format('create trigger safety_block_write before insert or update of %s on public.%I for each row execute function public.safety_write_guard()',cols,t);
    execute format('create trigger safety_review_insert after insert on public.%I for each row execute function public.safety_review_write()',t);
    execute format('create trigger safety_review_edit after update of %s on public.%I for each row when (old.* is distinct from new.*) execute function public.safety_review_write()',cols,t);
  end loop;
end;
$$;

-- Signup cannot bypass an email/phone ban through a direct auth request.
create or replace function public.safety_check_signup()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if exists(select 1 from public.identity_bans b where b.active and (
    (b.kind='email' and b.value_hash=public.identity_hash(new.email)) or
    (b.kind='phone' and b.value_hash=public.identity_hash(new.phone)))) then
    raise exception 'This account cannot register with Coolerup';
  end if;
  return new;
end;
$$;
revoke all on function public.safety_check_signup() from public,anon,authenticated;
create trigger coolerup_safety_signup before insert or update of email,phone on auth.users
for each row execute function public.safety_check_signup();
