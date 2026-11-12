# Music tab — full songs from the existing `sounds` table

## 1. Data layer
- [ ] `supabase/migrations/20261201000000_saved_sounds.sql` — `saved_sounds` join table (user_id, sound_id), RLS, no new songs table
- [ ] `supabase/sql-editor-saved-sounds.sql` — paste-into-SQL-Editor version + verification query
- [ ] `src/integrations/supabase/types.ts` — add `saved_sounds` types
- [ ] `src/lib/sounds.ts` — top/trending/saved queries, save/unsave, duration probe, cover helper

## 2. Player (persists across tabs)
- [ ] `src/lib/songPlayer.ts` — module-level singleton audio store (survives route changes)
- [ ] `src/components/MusicPlayer.tsx` — add `SongPlayerBar` dock (seek/play/next/prev/loop/volume) + keep old exports intact
- [ ] mount `<SongPlayerBar />` in `__root.tsx` so it never stops on tab change

## 3. UI
- [ ] `src/components/SongCard.tsx` — `SoundCover`, `SongCard` (carousel), `SongRow` (list)
- [ ] `src/routes/music.tsx` — search bar, 4 inner tabs, rows 1–4, safety note, Use this sound
- [ ] `src/routes/index.tsx` — add `🎵 Music` top tab after Videos

## 4. Verify
- [ ] `tsc --noEmit`, `vite build`, targeted vitest, eslint on changed files
- [ ] commit, push branch, open PR
