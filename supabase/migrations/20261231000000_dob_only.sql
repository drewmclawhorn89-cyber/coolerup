-- Retain historical records privately; stop accepting new identity documents.
drop policy if exists "age verification upload own" on storage.objects;
drop policy if exists "age verification replace own" on storage.objects;
revoke all on function public.submit_age_verification(text,text,text,text,date) from authenticated, anon, public;

create or replace function public.keep_signup_birthday()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.birthday is not null and new.birthday is distinct from old.birthday then
    raise exception 'Birthday cannot be changed after signup';
  end if;
  return new;
end;
$$;
drop trigger if exists keep_signup_birthday on public.profiles;
create trigger keep_signup_birthday before update of birthday on public.profiles
for each row execute function public.keep_signup_birthday();
