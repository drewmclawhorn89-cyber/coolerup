# Lifetime subscriptions

## Schema
- [x] `supabase/migrations/20261127000000_lifetime_subscriptions.sql` — `subscriptions` table, RLS, admin RPCs
- [x] `drizzle/migrations/0024_lifetime_subscriptions.sql` — mirror

## Client
- [x] `src/lib/plans.ts` — add the `all` (Lifetime All Access) plan
- [x] `src/lib/subscription.ts` — lifetime fetch/cache/store
- [x] `src/lib/subscriptions.ts` — overlay lifetime over localStorage, `all` satisfies every plan
- [x] `src/lib/beta.ts` — lifetime `all` unlocks the beta area

## UI
- [x] `src/components/LifetimeBadge.tsx` — gold crown badge
- [x] `src/routes/admin_.subscriptions.tsx` — grant / list / revoke
- [x] `src/components/SubscriptionsPanel.tsx` — lifetime banner
- [x] `src/routes/admin.tsx` — link to the Lifetime page

## Verify
- [x] tests
- [x] tsc / eslint / vitest / build
- [x] commit, push, PR (PR #212)
