-- ===========================================================================
-- 0030 · INSTANT TAKEDOWN
--
-- The problem this fixes: content was only screened *by the app*, after it had
-- already been written, by a classifier that runs in the browser. If the
-- classifier failed to load, if the post came in through a path that did not
-- call it (TikTok sync, a repost, a direct API call), or if the moderation RPC
-- was missing, the post stayed up. Nothing was removed "right away".
--
-- This migration moves the decision into Postgres, where it cannot be skipped:
--
--   * videos   -> BEFORE INSERT/UPDATE trigger hides the row the instant it is
--                 written, so it never appears in a feed, a profile grid or a
--                 search result. The row is kept (not deleted) so the owner can
--                 still see what was removed in AI Bot Logs and restore it.
--   * comments -> BEFORE INSERT trigger cancels the write outright.
--   * messages -> BEFORE INSERT trigger cancels the write outright.
--   * profiles -> BEFORE UPDATE trigger blanks a bio / display name that trips
--                 the filter.
--
-- Matching is done by `public.safety_classify()`, a self-contained port of the
-- client classifier. It does not depend on `banned_words` being populated, and
-- it is deliberately word-exact so "analysis" is not "anal" and "Pakistan" is
-- not a slur.
--
-- Reposts are explicitly exempt: a repost carries `source_id` / `source_url`
-- and the trigger returns early for those rows. The owner's own account is
-- exempt too.
--
-- Idempotent: safe to run more than once.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns the takedown path needs
-- ---------------------------------------------------------------------------

alter table public.videos add column if not exists hidden boolean not null default false;
alter table public.videos add column if not exists hidden_reason text;
alter table public.videos add column if not exists hidden_at timestamptz;
alter table public.videos add column if not exists hidden_by text;
alter table public.videos add column if not exists user_id uuid;

-- Backfill the owner of every existing video so the trigger can exempt the
-- owner and the log can name a real account.
update public.videos v
   set user_id = p.id
  from public.profiles p
 where v.user_id is null
   and lower(btrim(p.handle)) = lower(btrim(coalesce(v.username, '')));

create index if not exists videos_hidden_idx on public.videos (hidden);
create index if not exists videos_hidden_at_idx on public.videos (hidden_at desc);

-- ---------------------------------------------------------------------------
-- 2. The classifier
-- ---------------------------------------------------------------------------

/**
 * Fold leetspeak and punctuation so `p0rn`, `p.o.r.n` and `PORN` all match.
 * Mirrors `normalize()` in src/lib/autoBans.ts.
 */
create or replace function public.safety_normalize(_text text)
returns text
language sql
immutable
as $$
  select ' ' || btrim(
           regexp_replace(
             regexp_replace(
               regexp_replace(
                 regexp_replace(
                   regexp_replace(
                     regexp_replace(lower(coalesce(_text, '')), '[0@]', 'o', 'g'),
                   '[1!|]', 'i', 'g'),
                 '3', 'e', 'g'),
               '4', 'a', 'g'),
             '[5$]', 's', 'g'),
           '[^a-z ]', ' ', 'g')
         ) || ' ';
$$;

/**
 * Return the violation kind for a piece of text, or null when it is clean.
 *
 * Kinds, most serious first: threat, sexual, bullying, pii, spam. The first
 * match wins so the reason shown to the poster is the worst thing they did.
 *
 * `_scope` narrows the check: 'caption' and 'comment' skip the PII rules that
 * only make sense on a profile, and 'profile' skips the spam-link rules.
 */
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
  if _scope <> 'comment' then
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

grant execute on function public.safety_normalize(text) to anon, authenticated, service_role;
grant execute on function public.safety_classify(text, text) to anon, authenticated, service_role;

/** Human-readable reason for the AI Bot Logs screen. */
create or replace function public.safety_reason(_kind text)
returns text
language sql
immutable
as $$
  select case _kind
    when 'threat'   then 'Threat of violence'
    when 'sexual'   then 'Sexual or explicit content'
    when 'bullying' then 'Bullying or hate speech'
    when 'pii'      then 'Personal information or login details'
    when 'spam'     then 'Spam or scam'
    when 'fake'     then 'Fake account or impersonation'
    else 'Breaks Coolerup rules'
  end;
$$;

grant execute on function public.safety_reason(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Logging helper
-- ---------------------------------------------------------------------------

/**
 * Write one AI Bot Logs row.
 *
 * Never raises: a logging failure must not undo a takedown that already
 * happened, and it must not block a clean post either.
 */
create or replace function public.safety_log(
  _user_id uuid,
  _username text,
  _action text,
  _kind text,
  _content_type text,
  _content_id uuid,
  _excerpt text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    insert into public.moderation_log (
      action, actor, actor_id, auto, reason, username, user_id,
      kind, content_type, content_id, content_excerpt, strike_count,
      is_permanent
    )
    values (
      _action,
      'Coolerup Safety Bot',
      case when to_regprocedure('public.safety_bot_uid()') is not null
           then public.safety_bot_uid() else null end,
      true,
      public.safety_reason(_kind),
      lower(btrim(coalesce(_username, 'unknown'))),
      _user_id,
      _kind,
      _content_type,
      _content_id,
      left(coalesce(_excerpt, ''), 280),
      0,
      false
    );
  exception when others then
    -- The log table may not exist on a half-migrated database. Say so, move on.
    raise warning 'safety_log skipped: % (%)', sqlerrm, sqlstate;
  end;
end
$$;

grant execute on function public.safety_log(uuid, text, text, text, text, uuid, text)
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Videos: hide on write
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_video()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  owner_uid uuid := new.user_id;
begin
  -- Reposts are other people's videos. They are never flagged.
  if new.source_id is not null
     or coalesce(new.source_url, '') <> ''
     or coalesce(new.is_tiktok, false) then
    return new;
  end if;

  if owner_uid is null then
    select p.id into owner_uid
      from public.profiles p
     where lower(btrim(p.handle)) = lower(btrim(coalesce(new.username, '')))
     limit 1;
  end if;

  -- Never touch the owner's own posts.
  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and public.is_owner_uid(owner_uid) then
    return new;
  end if;

  kind := public.safety_classify(new.caption, 'caption');
  if kind is null then
    return new;
  end if;

  -- Hide immediately. The row survives so the owner can review and restore it,
  -- but every feed, grid and search filters `hidden`, so nobody sees it.
  new.hidden := true;
  new.hidden_reason := public.safety_reason(kind) || ' (auto)';
  new.hidden_at := now();
  new.hidden_by := 'Coolerup Safety Bot';

  perform public.safety_log(
    owner_uid, new.username, 'video_hidden', kind, 'video', new.id, new.caption
  );

  return new;
end
$$;

drop trigger if exists videos_safety_guard on public.videos;
create trigger videos_safety_guard
  before insert on public.videos
  for each row execute function public.safety_guard_video();

-- Postgres cannot combine INSERT with UPDATE OF in one trigger, so the edit
-- path gets its own. A caption edit must not be able to sneak bad text past
-- the check that ran at upload time.
drop trigger if exists videos_safety_guard_update on public.videos;
create trigger videos_safety_guard_update
  before update of caption on public.videos
  for each row execute function public.safety_guard_video();

-- ---------------------------------------------------------------------------
-- 5. Comments: refuse the write
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_comment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  owner_uid uuid;
  video_owner uuid;
begin
  kind := public.safety_classify(new.body, 'comment');
  if kind is null then
    return new;
  end if;

  select v.user_id into video_owner from public.videos v where v.id = new.video_id;

  select p.id into owner_uid
    from public.profiles p
   where lower(btrim(p.handle)) = lower(btrim(coalesce(new.username, '')))
   limit 1;

  -- The owner and the video's own author may speak freely.
  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and (public.is_owner_uid(owner_uid) or public.is_owner_uid(video_owner)) then
    return new;
  end if;

  perform public.safety_log(
    owner_uid, new.username, 'comment_removed', kind, 'comment', new.id, new.body
  );

  -- Returning null cancels the insert: the comment never exists, so it cannot
  -- be read, counted or cached by anyone.
  return null;
end
$$;

drop trigger if exists comments_safety_guard on public.comments;
create trigger comments_safety_guard
  before insert on public.comments
  for each row execute function public.safety_guard_comment();

-- ---------------------------------------------------------------------------
-- 6. Direct messages: refuse the write
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
begin
  kind := public.safety_classify(new.message, 'any');
  if kind is null then
    return new;
  end if;

  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and public.is_owner_uid(new.sender_id) then
    return new;
  end if;

  perform public.safety_log(
    new.sender_id, null, 'message_blocked', kind, 'message', new.id, new.message
  );

  return null;
end
$$;

drop trigger if exists messages_safety_guard on public.messages;
create trigger messages_safety_guard
  before insert on public.messages
  for each row execute function public.safety_guard_message();

-- ---------------------------------------------------------------------------
-- 7. Profiles: blank a bad bio or display name
-- ---------------------------------------------------------------------------

create or replace function public.safety_guard_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
  offending text;
begin
  if to_regprocedure('public.is_owner_uid(uuid)') is not null
     and public.is_owner_uid(new.id) then
    return new;
  end if;

  offending := coalesce(new.display_name, '') || ' ' || coalesce(new.bio, '');

  kind := public.safety_classify(offending, 'profile');
  if kind is null then
    return new;
  end if;

  -- Capture the offending text before it is blanked, or the log records
  -- nothing useful.
  perform public.safety_log(
    new.id, new.handle, 'profile_cleared', kind, 'profile', new.id, offending
  );

  new.bio := '[removed by Coolerup]';
  new.display_name := null;

  return new;
end
$$;

-- Two triggers, because Postgres cannot combine INSERT with UPDATE OF.
drop trigger if exists profiles_safety_guard on public.profiles;
create trigger profiles_safety_guard
  before update of bio, display_name on public.profiles
  for each row execute function public.safety_guard_profile();

drop trigger if exists profiles_safety_guard_insert on public.profiles;
create trigger profiles_safety_guard_insert
  before insert on public.profiles
  for each row execute function public.safety_guard_profile();

-- ---------------------------------------------------------------------------
-- 8. Sweep: clean what is already published
-- ---------------------------------------------------------------------------

/**
 * Re-scan everything that is already on the app.
 *
 * The triggers only protect new writes, so anything posted before this
 * migration is still live. This walks videos, comments and profiles and applies
 * the same rules. Returns a count per surface so the admin screen can show what
 * happened.
 *
 * Callable by the owner and admins only.
 */
create or replace function public.safety_bot_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_videos integer := 0;
  v_comments integer := 0;
  v_profiles integer := 0;
  r record;
  kind text;
begin
  if auth.uid() is not null
     and not public.has_role(auth.uid(), 'admin')
     and not (to_regprocedure('public.is_owner_uid(uuid)') is not null
              and public.is_owner_uid(auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  -- Videos.
  for r in
    select id, username, user_id, caption
      from public.videos
     where hidden = false
       and source_id is null
       and coalesce(source_url, '') = ''
       and coalesce(is_tiktok, false) = false
  loop
    if to_regprocedure('public.is_owner_uid(uuid)') is not null
       and public.is_owner_uid(r.user_id) then
      continue;
    end if;
    kind := public.safety_classify(r.caption, 'caption');
    if kind is null then
      continue;
    end if;
    update public.videos
       set hidden = true,
           hidden_reason = public.safety_reason(kind) || ' (sweep)',
           hidden_at = now(),
           hidden_by = 'Coolerup Safety Bot'
     where id = r.id;
    perform public.safety_log(r.user_id, r.username, 'video_hidden', kind, 'video', r.id, r.caption);
    v_videos := v_videos + 1;
  end loop;

  -- Comments: delete outright, there is nothing worth keeping.
  for r in
    select c.id, c.username, c.body
      from public.comments c
  loop
    kind := public.safety_classify(r.body, 'comment');
    if kind is null then
      continue;
    end if;
    perform public.safety_log(null, r.username, 'comment_removed', kind, 'comment', r.id, r.body);
    delete from public.comments where id = r.id;
    v_comments := v_comments + 1;
  end loop;

  -- Profiles.
  for r in
    select id, handle, display_name, bio from public.profiles
  loop
    if to_regprocedure('public.is_owner_uid(uuid)') is not null
       and public.is_owner_uid(r.id) then
      continue;
    end if;
    kind := public.safety_classify(
      coalesce(r.display_name, '') || ' ' || coalesce(r.bio, ''), 'profile'
    );
    if kind is null then
      continue;
    end if;
    perform public.safety_log(r.id, r.handle, 'profile_cleared', kind, 'profile', r.id,
                              coalesce(r.display_name, '') || ' ' || coalesce(r.bio, ''));
    update public.profiles
       set bio = '[removed by Coolerup]', display_name = null
     where id = r.id;
    v_profiles := v_profiles + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'videos_hidden', v_videos,
    'comments_removed', v_comments,
    'profiles_cleared', v_profiles
  );
end
$$;

revoke all on function public.safety_bot_sweep() from public;
grant execute on function public.safety_bot_sweep() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Purge: actually delete what was hidden
-- ---------------------------------------------------------------------------

/**
 * Delete every hidden video. Hiding is enough to keep it out of the app, but
 * the file still sits in storage and costs money. Owner and admins only.
 */
create or replace function public.purge_hidden_videos()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if auth.uid() is not null
     and not public.has_role(auth.uid(), 'admin')
     and not (to_regprocedure('public.is_owner_uid(uuid)') is not null
              and public.is_owner_uid(auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'not_authorized');
  end if;

  with gone as (
    delete from public.videos where hidden = true returning id
  )
  select count(*) into n from gone;

  return jsonb_build_object('ok', true, 'deleted', n);
end
$$;

revoke all on function public.purge_hidden_videos() from public;
grant execute on function public.purge_hidden_videos() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. Visibility: hidden rows must never be readable
-- ---------------------------------------------------------------------------

-- RESTRICTIVE, so it can only ever remove visibility, never grant it.
drop policy if exists "hide moderated videos" on public.videos;
create policy "hide moderated videos" on public.videos
  as restrictive for select to anon, authenticated
  using (not hidden);

-- Same idea for comments: nothing marked removed is readable.
drop policy if exists "hide removed comments" on public.comments;
create policy "hide removed comments" on public.comments
  as restrictive for select to anon, authenticated
  using (coalesce(body, '') <> '[removed by Coolerup]');

notify pgrst, 'reload schema';
