-- Web Push subscriptions.
--
-- One row per browser/device a user has granted notification permission on.
-- The app writes these through the service-role client (savePushSubscription),
-- so RLS below mainly protects against accidental anon access. Written to be
-- idempotent so it is safe to re-run on the existing project.

create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  p256dh text not null,
  "auth" text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx
  on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

-- A signed-in user may only see and remove their own device registrations.
-- Inserts/updates are performed server-side with the service role.
drop policy if exists "users read own push subscriptions" on public.push_subscriptions;
create policy "users read own push subscriptions" on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "users delete own push subscriptions" on public.push_subscriptions;
create policy "users delete own push subscriptions" on public.push_subscriptions
  for delete using (auth.uid() = user_id);
