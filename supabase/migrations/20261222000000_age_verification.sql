-- ============================================================================
-- Coolerup · Real ID verification for 18+ videos
-- ============================================================================
--
-- The Date of Birth on an account is self-reported, so it can never be the
-- thing that unlocks adult content: anyone can type any birthday. This
-- migration adds a real identity check on top of it.
--
-- A user uploads a photo of their government ID plus a selfie. Those files go
-- into a PRIVATE storage bucket that only the owner and an admin can read.
-- Nothing is auto-approved: a moderator reviews the pair and flips the row to
-- `approved` or `rejected`.
--
-- Watching an 18+ video now requires BOTH:
--   1. the account's Date of Birth says 18 or older, and
--   2. `age_verifications.status = 'approved'`.
--
-- The table itself is write-locked: there is no client INSERT or UPDATE policy.
-- The only way a row is created or changed is through the SECURITY DEFINER
-- functions below, which force `user_id = auth.uid()` and force the status to
-- `pending`. A user cannot approve themselves.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The verification record
-- ---------------------------------------------------------------------------
create table if not exists public.age_verifications (
  user_id uuid primary key references auth.users (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  document_type text
    check (document_type in ('drivers_license', 'passport', 'state_id', 'national_id')),
  -- Object paths inside the `age-verification` bucket, never public URLs.
  document_path text,
  selfie_path text,
  country text,
  -- The date printed on the ID, kept separate from the profile birthday so a
  -- moderator can spot a mismatch.
  id_date_of_birth date,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id),
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.age_verifications is
  'Government ID + selfie checks that unlock 18+ videos. Reviewed by a moderator; a user can never approve their own row.';

comment on column public.age_verifications.document_path is
  'Path inside the private age-verification bucket. Never a public URL.';

-- Fast lookup for the moderator queue.
create index if not exists age_verifications_pending_idx
  on public.age_verifications (submitted_at)
  where status = 'pending';

create index if not exists age_verifications_status_idx
  on public.age_verifications (status);

-- ---------------------------------------------------------------------------
-- 2. RLS: the owner may read their own status, nobody may write directly
-- ---------------------------------------------------------------------------
alter table public.age_verifications enable row level security;

-- Owners can see the status of their own check (needed to render "In review").
drop policy if exists "age verifications read own" on public.age_verifications;
create policy "age verifications read own"
  on public.age_verifications
  for select
  to authenticated
  using (user_id = auth.uid());

-- Admins can read every row so the review queue works.
drop policy if exists "age verifications admin read" on public.age_verifications;
create policy "age verifications admin read"
  on public.age_verifications
  for select
  to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- Deliberately NO insert/update/delete policies. Writes happen only through the
-- SECURITY DEFINER functions below, which ignore whatever the client sends for
-- `status` and `user_id`.
revoke insert, update, delete on public.age_verifications from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Private storage bucket for the ID photo and the selfie
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('age-verification', 'age-verification', false)
on conflict (id) do nothing;

-- Each user may only write inside their own folder: <user_id>/...
drop policy if exists "age verification upload own" on storage.objects;
create policy "age verification upload own"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'age-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "age verification read own" on storage.objects;
create policy "age verification read own"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'age-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- A user may replace their own uploads when resubmitting after a rejection.
drop policy if exists "age verification replace own" on storage.objects;
create policy "age verification replace own"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'age-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'age-verification'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ---------------------------------------------------------------------------
-- 4. The viewer's own status, safe to call from the browser
-- ---------------------------------------------------------------------------
create or replace function public.my_age_verification()
returns table (
  status text,
  document_type text,
  country text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.status,
    v.document_type,
    v.country,
    v.submitted_at,
    v.reviewed_at,
    v.rejection_reason
  from public.age_verifications v
  where v.user_id = auth.uid();
$$;

revoke all on function public.my_age_verification() from public, anon;
grant execute on function public.my_age_verification() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Submit (or resubmit) a check
-- ---------------------------------------------------------------------------
-- `status` is never taken from the caller: every submission starts at
-- 'pending', and any previous approval is cleared so a resubmission cannot ride
-- on the old decision.
create or replace function public.submit_age_verification(
  _document_type text,
  _document_path text,
  _selfie_path text,
  _country text default null,
  _id_date_of_birth date default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null then
    raise exception 'Sign in to verify your ID';
  end if;

  if _document_type not in ('drivers_license', 'passport', 'state_id', 'national_id') then
    raise exception 'Pick a valid ID type';
  end if;

  -- The paths must live in this user's own folder; otherwise someone could
  -- point their row at another person's document.
  if _document_path is null or _selfie_path is null then
    raise exception 'Both an ID photo and a selfie are required';
  end if;
  if split_part(_document_path, '/', 1) <> _uid::text
     or split_part(_selfie_path, '/', 1) <> _uid::text then
    raise exception 'Those uploads do not belong to you';
  end if;

  insert into public.age_verifications as v (
    user_id,
    status,
    document_type,
    document_path,
    selfie_path,
    country,
    id_date_of_birth,
    submitted_at,
    reviewed_at,
    reviewed_by,
    rejection_reason,
    updated_at
  )
  values (
    _uid,
    'pending',
    _document_type,
    _document_path,
    _selfie_path,
    _country,
    _id_date_of_birth,
    now(),
    null,
    null,
    null,
    now()
  )
  on conflict (user_id) do update set
    status = 'pending',
    document_type = excluded.document_type,
    document_path = excluded.document_path,
    selfie_path = excluded.selfie_path,
    country = excluded.country,
    id_date_of_birth = excluded.id_date_of_birth,
    submitted_at = now(),
    reviewed_at = null,
    reviewed_by = null,
    rejection_reason = null,
    updated_at = now();

  return 'pending';
end;
$$;

revoke all on function public.submit_age_verification(text, text, text, text, date)
  from public, anon;
grant execute on function public.submit_age_verification(text, text, text, text, date)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Moderator queue
-- ---------------------------------------------------------------------------
create or replace function public.admin_age_verifications(_status text default 'pending')
returns table (
  user_id uuid,
  username text,
  display_name text,
  status text,
  document_type text,
  document_path text,
  selfie_path text,
  country text,
  id_date_of_birth date,
  profile_birthday date,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  rejection_reason text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.user_id,
    p.handle as username,
    p.display_name,
    v.status,
    v.document_type,
    v.document_path,
    v.selfie_path,
    v.country,
    v.id_date_of_birth,
    p.birthday as profile_birthday,
    v.submitted_at,
    v.reviewed_at,
    v.rejection_reason
  from public.age_verifications v
  left join public.profiles p on p.id = v.user_id
  where public.has_role(auth.uid(), 'admin')
    and (_status is null or v.status = _status)
  order by v.submitted_at asc
  limit 200;
$$;

revoke all on function public.admin_age_verifications(text) from public, anon;
grant execute on function public.admin_age_verifications(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Moderator decision
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_age_verification(
  _user_id uuid,
  _approve boolean,
  _reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  _uid uuid := auth.uid();
begin
  if _uid is null or not public.has_role(_uid, 'admin') then
    return jsonb_build_object('ok', false, 'error', 'Admins only');
  end if;

  if _user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Missing user');
  end if;

  update public.age_verifications
     set status = case when _approve then 'approved' else 'rejected' end,
         reviewed_at = now(),
         reviewed_by = _uid,
         rejection_reason = case
           when _approve then null
           else coalesce(nullif(trim(_reason), ''), 'The ID could not be verified')
         end,
         updated_at = now()
   where user_id = _user_id;

  if not found then
    return jsonb_build_object('ok', false, 'error', 'No verification to review');
  end if;

  return jsonb_build_object('ok', true, 'status', case when _approve then 'approved' else 'rejected' end);
end;
$$;

revoke all on function public.admin_review_age_verification(uuid, boolean, text)
  from public, anon;
grant execute on function public.admin_review_age_verification(uuid, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Keep updated_at honest
-- ---------------------------------------------------------------------------
create or replace function public.touch_age_verification()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists age_verifications_touch on public.age_verifications;
create trigger age_verifications_touch
  before update on public.age_verifications
  for each row execute function public.touch_age_verification();
