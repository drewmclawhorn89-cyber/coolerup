# 18+ Mature Video Toggle
## Data
- [x] Migration: `is_mature` on videos + full_videos, index
- [x] `Video` / `FullVideo` types gain `is_mature`
- [x] `src/lib/matureVideos.ts` pure helpers (age check, pref, label)
## Posting
- [x] UploadDialog: "Mark as 18+ — Mature" toggle (OFF default, video only)
- [x] uploadVideo passes `is_mature` (tolerant if column missing)
- [x] Long-form upload page: same toggle + createFullVideo support
## Feed / watching
- [x] VideoCard: blurred thumbnail + "18+ Mature" + lock; DOB gate + block under 18
- [x] watch.$id.tsx: same gate for long-form
- [x] Feed hides 18+ when "Show 18+ Videos" is OFF
## Settings
- [x] Settings > Privacy "Show 18+ Videos" ON/OFF (black bg, white text)
## Verify
- [x] Tests for helpers + wiring (19 passing)
- [x] Typecheck/build/test
- [x] Push branch + open PR (https://github.com/drewmclawhorn89-cyber/coolerup/pull/331)
