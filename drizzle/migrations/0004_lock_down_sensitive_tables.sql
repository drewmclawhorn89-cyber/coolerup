-- Close three over-permissive RLS policies found by the security scan.

-- 1) banned_users: no public reads. The app checks bans via the is_banned() security-definer function instead.
drop policy if exists "bans readable" on public.banned_users;
revoke select on public.banned_users from anon;
revoke select on public.banned_users from authenticated;

-- 2) messages: legacy table no longer used by the app (superseded by direct_messages). Remove all public access.
drop policy if exists "anyone can message" on public.messages;
revoke all on public.messages from anon;
revoke all on public.messages from authenticated;
comment on table public.messages is 'DEPRECATED: no longer used by the app; superseded by direct_messages';

-- 3) app_settings: readable/writable only by admins.
drop policy if exists "allow all" on public.app_settings;
revoke all on public.app_settings from anon;
create policy "admins manage app_settings"
  on public.app_settings
  for all
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role))
  with check (has_role(auth.uid(), 'admin'::app_role));