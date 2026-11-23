# Banned accounts hide their videos everywhere

## Data layer (migration)
- [x] `account_is_banned(uid)` / `handle_is_banned(handle)` / `banned_handles()` RPCs
- [x] RESTRICTIVE select policies on `videos` and `full_videos`
- [x] Trigger mirrors bans into `videos.hidden` (`hidden_reason = 'Author banned'`)
- [x] Unban restores only ban-hidden rows
- [x] Backfill existing bans

## Client safety net
- [x] `useBannedHandles()` hook in `src/lib/safety.ts` (cached `banned_handles` RPC)
- [x] Feed `shown` filter in `src/routes/index.tsx` drops banned authors
- [x] `searchVideos` + `searchUsers` drop banned handles in `src/lib/search.ts`
- [x] Profile page shows `BANNED_TEXT` for a banned handle
- [x] `fullVideos.ts` list/related/get filter banned authors

## Verify
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean
- [x] `npx vitest run` — 960/960 baseline stays green, new tests pass
- [x] eslint clean on changed files

## Ship
- [x] Branch, commit, push
- [x] Open PR and merge
- [x] Hand the SQL to the user for the Supabase SQL editor
