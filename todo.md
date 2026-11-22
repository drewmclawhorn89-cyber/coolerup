# Real-ID 18+ Gate (short form fix + ID verification)

## Data / backend
- [x] Migration `20261222000000_age_verification.sql` (table, RLS lockdown, private bucket, 4 RPCs)
- [x] `src/lib/ageVerification.ts` client (status hook, upload, submit, signed URL)
- [x] `src/lib/matureVideos.ts` requires `age_verifications.status = 'approved'`
- [x] Add `age_verifications` + 4 RPCs to `src/integrations/supabase/types.ts`

## UI
- [x] `AgeVerificationDialog.tsx`
- [x] VideoCard: gate `togglePlay`, lock TikTok iframe, overlay with "Verify my ID"
- [x] watch.$id: same ID gate + overlay
- [x] Settings: "Verify your ID for 18+ videos" row with live status
- [x] Admin: ID Checks tab (view docs, approve/reject)

## Feed correctness
- [x] `src/lib/loop.ts`: add `is_mature` to LEGACY_COLUMNS + fallback regex

## Verify
- [x] Update `src/test/mature-videos.test.ts` for new signature/reasons
- [x] New tests for ageVerification + VideoCard gating
- [x] `npx tsc --noEmit`, `npm run build`, `npx vitest run` (938/938)
- [ ] Branch, commit, push, PR, merge
