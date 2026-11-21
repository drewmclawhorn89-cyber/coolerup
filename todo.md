# Auto Bans: sexual / bullying / spam with 3-strike ladder

## Database layer (done)
- [x] `supabase/migrations/20261217000000_auto_bans.sql` — strikes, devices, identity bans, `auto_moderate` ladder, `admin_ban_list`, `owner_unban`
- [x] One-paste copy at `supabase/sql-editor-auto-bans.sql` for the SQL Editor

## Client layer (done)
- [x] `src/lib/autoBans.ts` — classifier, device id, ladder client, admin client
- [x] `src/components/WarningModal.tsx` — 1/3, 2/3, 3/3 popup in black/white/#FE2C55
- [x] `src/components/BanGate.tsx` — permanent-ban + device-ban full screens
- [x] `src/components/ReportButton.tsx` — report on video / comment / profile

## Wiring (todo)
- [x] Shared `WarningProvider` context so any surface can raise the popup
- [x] Hook `screenContent` into video upload (`src/lib/loop.ts`)
- [x] Hook `screenContent` into comments (`src/components/Comments.tsx`)
- [x] Hook `screenContent` into profile bio/avatar (`src/components/EditProfileDialog.tsx`)
- [x] Enforce 24h mute: block post/comment while muted, show mute notice
- [x] Mount `ReportButton` on video cards, comments, profiles
- [x] Admin Ban List panel in `src/routes/admin.tsx` + owner-only Unban
- [x] Update `src/lib/moderation.ts` policy comment + `sexual` reason id

## Verify
- [x] Tests for `classifyText` (threat > sexual, leetspeak, spam links, clean)
- [x] `npx tsc --noEmit`, `npx vitest run`, `npx vite build`
- [x] Commit, push, open PR

## Flag to user
- [x] This reverses the "auto-bans are DISABLED" policy written in their own code
- [x] Profile-pic explicit detection needs an image classifier (no provider in repo)
