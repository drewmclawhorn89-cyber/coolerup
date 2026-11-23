-- ===========================================================================
-- 20261226000000 · DM MEDIA (PICS, VIDEOS, COOLERUP VIDEOS), VIEW ONCE & PRIVACY
--
-- 1. Adds `profiles.allow_messages_from_everyone` (default false) so Settings
--    controls whether strangers may send pics / videos in Messages.
-- 2. Extends `direct_messages` with media fields, `view_once`, `view_once_opened_at`,
--    and soft-delete flags for sender / recipient.
-- 3. Enforces mutual-follow or `allow_messages_from_everyone = true` whenever
--    `media_url` is sent in a DM (policy + trigger guard).
-- 4. Adds atomic `open_view_once_dm(uuid)` and `delete_dm_message(uuid)` RPCs.
-- 5. Provisions private `dm-media` storage bucket + policies for chat photos/videos.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. Profile messaging privacy setting
-- ---------------------------------------------------------------------------

alter table public.profiles
  add column if not exists allow_messages_from_everyone boolean not null default false;

-- ---------------------------------------------------------------------------
-- 2. Direct messages media + view-once + delete columns
-- ---------------------------------------------------------------------------

alter table public.direct_messages add column if not exists media_url text;
alter table public.direct_messages add column if not exists media_type text;
alter table public.direct_messages add column if not exists media_video_id uuid;
alter table public.direct_messages add column if not exists media_caption text;
alter table public.direct_messages add column if not exists media_has_external_watermark boolean not null default false;
alter table public.direct_messages add column if not exists view_once boolean not null default false;
alter table public.direct_messages add column if not exists view_once_opened_at timestamptz;
alter table public.direct_messages add column if not exists deleted_by_sender boolean not null default false;
alter table public.direct_messages add column if not exists deleted_by_recipient boolean not null default false;

alter table public.direct_messages
  drop constraint if exists direct_messages_media_type_check;
alter table public.direct_messages
  add constraint direct_messages_media_type_check
  check (media_type is null or media_type in ('image', 'video', 'coolerup_video'));

-- ---------------------------------------------------------------------------
-- 3. Mutual-follow + media permission helpers
-- ---------------------------------------------------------------------------

create or replace function public.are_mutual_followers(
  _user_a uuid,
  _user_b uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when _user_a is null or _user_b is null then false
      when _user_a = _user_b then true
      else exists (
        select 1
        from public.profiles pa
        join public.profiles pb on pb.id = _user_b
        where pa.id = _user_a
          and exists (
            select 1
            from public.follows fa
            where fa.follower_id = _user_a
              and lower(fa.following_username) = lower(pb.handle)
          )
          and exists (
            select 1
            from public.follows fb
            where fb.follower_id = _user_b
              and lower(fb.following_username) = lower(pa.handle)
          )
      )
    end;
$$;

revoke all on function public.are_mutual_followers(uuid, uuid) from public;
grant execute on function public.are_mutual_followers(uuid, uuid) to authenticated, service_role;

create or replace function public.can_send_dm_media(
  _sender_id uuid,
  _recipient_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    case
      when _sender_id is null or _recipient_id is null then false
      when _sender_id = _recipient_id then true
      else (
        coalesce(
          (select p.allow_messages_from_everyone from public.profiles p where p.id = _recipient_id),
          false
        )
        or public.are_mutual_followers(_sender_id, _recipient_id)
      )
    end;
$$;

revoke all on function public.can_send_dm_media(uuid, uuid) from public;
grant execute on function public.can_send_dm_media(uuid, uuid) to authenticated, service_role;

-- Trigger guard so media DMs from strangers without allow_messages_from_everyone
-- always fail cleanly even if inserted outside normal client checks.
create or replace function public.enforce_dm_media_privacy()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.media_url is not null then
    if not public.can_send_dm_media(new.from_id, new.to_id) then
      raise exception 'Only mutual followers can send pics or videos unless the recipient allows messages from everyone.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists direct_messages_media_privacy_guard on public.direct_messages;
create trigger direct_messages_media_privacy_guard
  before insert on public.direct_messages
  for each row
  execute function public.enforce_dm_media_privacy();

-- ---------------------------------------------------------------------------
-- 4. Update direct_messages RLS policies
-- ---------------------------------------------------------------------------

drop policy if exists "dm read own" on public.direct_messages;
create policy "dm read own"
  on public.direct_messages for select
  to authenticated
  using (
    (auth.uid() = from_id and not coalesce(deleted_by_sender, false))
    or (auth.uid() = to_id and not coalesce(deleted_by_recipient, false))
  );

drop policy if exists "dm send as self" on public.direct_messages;
create policy "dm send as self"
  on public.direct_messages for insert
  to authenticated
  with check (
    from_id = auth.uid()
    and (
      length(coalesce(message, '')) between 1 and 2000
      or gif_url is not null
      or media_url is not null
    )
    and length(coalesce(message, '')) <= 2000
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and lower(p.handle) = lower(from_username)
    )
    and exists (
      select 1 from public.profiles p
      where p.id = to_id and lower(p.handle) = lower(to_username)
    )
    and (
      media_url is null
      or public.can_send_dm_media(auth.uid(), to_id)
    )
  );

drop policy if exists "dm delete own" on public.direct_messages;
create policy "dm delete own"
  on public.direct_messages for delete
  to authenticated
  using (auth.uid() = from_id);

-- ---------------------------------------------------------------------------
-- 5. Atomic View-Once Open & Delete RPCs
-- ---------------------------------------------------------------------------

create or replace function public.open_view_once_dm(_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _row public.direct_messages%rowtype;
begin
  if _uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select * into _row
  from public.direct_messages
  where id = _message_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Message not found');
  end if;

  if _row.from_id = _uid and _row.to_id <> _uid then
    return jsonb_build_object('ok', false, 'error', 'Only the recipient can open View Once media');
  end if;

  if _row.to_id <> _uid then
    return jsonb_build_object('ok', false, 'error', 'Forbidden');
  end if;

  if not coalesce(_row.view_once, false) then
    return jsonb_build_object(
      'ok', true,
      'media_url', _row.media_url,
      'media_type', _row.media_type,
      'media_video_id', _row.media_video_id,
      'media_caption', _row.media_caption,
      'media_has_external_watermark', coalesce(_row.media_has_external_watermark, false)
    );
  end if;

  if _row.view_once_opened_at is not null or _row.media_url is null then
    return jsonb_build_object('ok', false, 'expired', true, 'error', 'Already opened');
  end if;

  update public.direct_messages
  set view_once_opened_at = now(),
      media_url = null
  where id = _message_id;

  return jsonb_build_object(
    'ok', true,
    'media_url', _row.media_url,
    'media_type', _row.media_type,
    'media_video_id', _row.media_video_id,
    'media_caption', _row.media_caption,
    'media_has_external_watermark', coalesce(_row.media_has_external_watermark, false),
    'view_once_opened_at', now()
  );
end;
$$;

revoke all on function public.open_view_once_dm(uuid) from public;
grant execute on function public.open_view_once_dm(uuid) to authenticated, service_role;

create or replace function public.delete_dm_message(_message_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
  _row public.direct_messages%rowtype;
begin
  if _uid is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  select * into _row
  from public.direct_messages
  where id = _message_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Message not found');
  end if;

  if _row.from_id = _uid then
    delete from public.direct_messages where id = _message_id;
    return jsonb_build_object('ok', true, 'mode', 'deleted');
  end if;

  if _row.to_id = _uid then
    update public.direct_messages
    set deleted_by_recipient = true
    where id = _message_id;
    return jsonb_build_object('ok', true, 'mode', 'hidden_for_recipient');
  end if;

  return jsonb_build_object('ok', false, 'error', 'Forbidden');
end;
$$;

revoke all on function public.delete_dm_message(uuid) from public;
grant execute on function public.delete_dm_message(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Private Storage Bucket for DM Pics & Videos
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dm-media',
  'dm-media',
  false,
  104857600,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'image/avif',
    'image/heic',
    'video/mp4',
    'video/webm',
    'video/quicktime'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = 104857600;

drop policy if exists "dm-media authenticated read" on storage.objects;
create policy "dm-media authenticated read"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'dm-media');

drop policy if exists "dm-media owner insert" on storage.objects;
create policy "dm-media owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'dm-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "dm-media owner delete" on storage.objects;
create policy "dm-media owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'dm-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

notify pgrst, 'reload schema';
