# AI Safety Bots for Coolerup

## Detection
- [x] Extend classifier: PII/passwords, fake-account impersonation, keep 3-strike ordering
- [x] Screen messages (DMs) and profile name/bio; keep profile-pic + video image checks
- [x] Change sexual content from instant ban to the 1/2/3 ladder

## UI
- [x] Coolerup Safety Bot badge (green check) + bot profile
- [x] Report button on long-form video page
- [x] Warning popup already black/white/#FE2C55 — verified
- [x] Admin AI Bot Logs page with owner-only Unban

## Database
- [x] New migration: ladder without sexual shortcut, owner protection, bot log columns + RPC
- [x] 5 reports + AI agreement -> auto-hide video until owner review

## Verify
- [x] Tests for classifier + fake/PII
- [x] Typecheck/build
- [x] Push branch + open PR
