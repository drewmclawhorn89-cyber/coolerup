# Link TikTok Account

## Data
- [x] Migration: `tiktok_accounts` (server-only tokens) + `my_tiktok_account()` RPC + publish log
- [x] Types for the new table/RPC

## OAuth (Login Kit)
- [x] `src/lib/tiktokLink.server.ts` — creds, redirect, sealed state, token exchange/refresh, API calls
- [x] `/api/tiktok/auth/url` — requires signed-in user, returns authorize URL
- [x] `/api/tiktok/auth/callback` — exchange code, store tokens, postMessage back
- [x] `/api/tiktok/unlink` — delete the caller's link
- [x] `/api/tiktok/videos` — list the caller's OWN videos (video.list)
- [x] `/api/tiktok/publish` — Content Posting API, caption + "Posted from Coolerup"

## Client lib
- [x] `src/lib/tiktokLink.ts` — `useTikTokAccount`, link/unlink, import, publish, share helpers

## UI
- [x] Settings > Linked Accounts: Link button, "Connected as @username", Unlink (black/white)
- [x] UploadDialog: "Also post to TikTok" toggle (ON/OFF)
- [x] Import from TikTok picker (own videos only)
- [x] Profile: TikTok + Coolerup follower counts, Share Coolerup to TikTok, Share TikTok to Coolerup

## Verify
- [x] Tests (31 in `src/test/tiktok-link.test.ts`)
- [x] Typecheck/build/test (tsc clean, vite build ok, 909/909 tests pass)
- [x] Push branch + PR + merge
