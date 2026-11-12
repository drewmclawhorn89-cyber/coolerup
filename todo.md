# Make Your Own GIFs (TikTok-style)

## Database & storage
- [x] Add migration: `gifs` table, RLS, `gif_reports`, `gifs` public bucket (5MB), `gif_credit` columns on comments tables
- [x] Update `src/integrations/supabase/types.ts` for new tables/columns

## Core library
- [x] Create `src/lib/gif.ts`: constants, list/search, upload+insert, delete, report, ffmpeg video→GIF conversion (trim/speed/crop/text/sticker, 5MB cap)

## UI
- [x] Create `src/components/MakeGif.tsx`: source pick (my videos / record 3s / upload), trim, edit, create, success
- [x] Create `src/routes/make-gif.tsx` page
- [x] Update `GifPicker.tsx`: keep search + grid + composer, add [+ Make GIF], Trending / My GIFs tabs, credit labels, report/delete

## Integrations
- [x] Comments (feed): store + show GIF credit
- [x] Full-video comments (`watch.$id.tsx` + `fullVideos.ts`): store + show credit
- [x] LIVE chat: carry + show GIF credit
- [x] DMs / Inbox picker wiring (if composer exists)

## Verify
- [x] Install deps, typecheck/build, run tests
- [x] Commit, push branch, open PR
