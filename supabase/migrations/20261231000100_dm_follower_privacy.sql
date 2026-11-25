grant select (allow_messages_from_everyone) on public.profiles to authenticated;
-- Apply recipient privacy to text, GIFs and attachments, including old clients.
create or replace function public.can_send_dm_media(_sender_id uuid, _recipient_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select _sender_id is not null and exists (
    select 1 from public.profiles p where p.id = _recipient_id and (
      p.id = _sender_id or p.allow_messages_from_everyone or exists (
        select 1 from public.follows f where f.follower_id = _sender_id
          and lower(f.following_username) = lower(p.handle)
      )
    )
  );
$$;

create or replace function public.enforce_dm_media_privacy()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not public.can_send_dm_media(new.from_id, new.to_id) then
    raise exception 'Follow this account before sending a message.' using errcode = '42501';
  end if;
  return new;
end;
$$;
