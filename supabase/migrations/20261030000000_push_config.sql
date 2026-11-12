-- VAPID credentials for Web Push, stored server-side.
--
-- Normally these live in the hosting provider's environment variables. This
-- table is a fallback for projects where env vars can't be set, so the keys can
-- be installed from the Supabase SQL editor instead.
--
-- SECURITY: RLS is enabled and there are deliberately NO policies. Only the
-- service-role client (used by the server functions) can read this table. Anon
-- and authenticated users get nothing, so the private key is never exposed to a
-- browser.

create table if not exists public.push_config (
  id text primary key default 'default',
  subject text not null,
  public_key text not null,
  private_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_config_singleton check (id = 'default')
);

alter table public.push_config enable row level security;

-- Explicitly remove any policy that might have been created previously, so the
-- table can never be read by a non-service-role client.
drop policy if exists "no client access to push config" on public.push_config;
