# Offline Mode for Paid Subscribers — Coolerup

## Core
- [x] Gate Offline Mode on a live paid plan (`planUnlocksOffline`), not the free trial
- [x] Add "Offline Mode is for Paid Subscribers" popup with Subscribe button
- [x] Ensure nothing downloads for non-paid accounts
- [x] Add Offline Mode toggle in Settings (paid only)
- [x] Auto-download liked and saved videos when the toggle is ON
- [x] Enforce a 50-video cap in the offline store
- [x] Show storage used in Settings > Offline Mode with a Clear Downloads button
- [x] Show an Offline tab in Videos when the device has no connection, playing local downloads
- [x] Keep black background / white text; change nothing else

## Surfaces updated
- [x] `src/lib/offline.ts` — `MAX_OFFLINE_VIDEOS`, `OfflineLimitError`, cap check
- [x] `src/lib/offlineMode.ts` — persisted toggle + online status hooks
- [x] `src/lib/offlineEvents.ts` — sync event bus
- [x] `src/lib/offlineAutoDownload.ts` — liked/saved sync engine
- [x] `src/components/OfflineAutoDownloadWatcher.tsx` — background sync
- [x] `src/components/OfflinePaywallDialog.tsx` — paid-only popup
- [x] `src/lib/useFullVideoOffline.ts` — paid-only, opens paywall
- [x] `src/components/ShareMenu.tsx` / `FullVideoShareMenu.tsx` — paid-only
- [x] `src/routes/settings.tsx` — toggle, meter, Clear Downloads
- [x] `src/routes/videos.tsx` — Offline tab, local playback, offline banner
- [x] `src/routes/offline.tsx` — paid-only messaging
- [x] `src/components/FullVideoCard.tsx` — `onOpen` for local playback

## Verification
- [x] `vitest run` — 668 tests pass (22 new in `offline-paid-mode.test.ts`)
- [x] `vite build` succeeds
- [x] Commit, push branch, open PR
