# Forced watermark on every Coolerup export

## Build the watermark engine
- [x] Create `src/lib/watermark.ts` — always-on helper, no disable flag
- [x] Draw logo + `@username` as a transparent PNG (bottom right, semi-transparent)
- [x] Burn it into every video frame with ffmpeg `overlay` (reuses lazy loader)
- [x] Canvas path for still images
- [x] Fail closed: throw `WatermarkError`, never return the clean blob

## Route every export through it
- [x] `ShareMenu.tsx` download (short form)
- [x] `ShareMenu.tsx` share-sheet file
- [x] `FullVideoShareMenu.tsx` download (long form)
- [x] `FullVideoShareMenu.tsx` share-sheet file
- [x] `offline.tsx` short-video download
- [x] `offline.tsx` full-video download
- [x] `offline.tsx` view no longer opens a raw blob tab
- [x] Leave the JSON data export in `MoreSettings.tsx` untouched

## Verify
- [x] `npx tsc --noEmit` clean
- [x] `npm run build` clean
- [x] `npx vitest run` — 960/960 passing (22 new)
- [x] eslint clean on changed files

## Ship
- [ ] Branch, commit, push
- [ ] Open PR and merge
