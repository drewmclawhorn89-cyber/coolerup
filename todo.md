# Music tab — full songs from the existing `sounds` table

## 1. Data layer
- [x] `supabase/migrations/20261201000000_saved_sounds.sql` — `saved_sounds` join table (user_id, sound_id), RLS, no new songs table
- [x] `supabase/sql-editor-saved-sounds.sql` — paste-into-SQL-Editor version + verification query
- [x] `src/integrations/supabase/types.ts` — add `saved_sounds` types
- [x] `src/lib/sounds.ts` — top/trending/saved queries, save/unsave, duration probe, cover helper

## 2. Player (persists across tabs)
- [x] `src/lib/songPlayer.ts` — module-level singleton audio store (survives route changes)
- [x] `src/components/MusicPlayer.tsx` — add `SongPlayerBar` dock (seek/play/next/prev/loop/volume) + keep old exports intact
- [x] mount `<SongPlayerBar />` in `__root.tsx` so it never stops on tab change

## 3. UI
- [x] `src/components/SongCard.tsx` — `SoundCover`, `SongCard` (carousel), `SongRow` (list)
- [x] `src/routes/music.tsx` — search bar, 4 inner tabs, rows 1–4, safety note, Use this sound
- [x] `src/routes/index.tsx` — add `🎵 Music` top tab after Videos

## 4. Verify
- [x] `tsc --noEmit`, `vite build`, targeted vitest, eslint on changed files
- [x] commit, push branch, open PR
