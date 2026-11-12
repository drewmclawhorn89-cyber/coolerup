# Coolerup PWA + PWABuilder task

## Recon (done)
- [x] Inspect repo structure — TanStack Start SSR, no plain index.html
- [x] Found existing `public/manifest.webmanifest`, `public/sw.js`, icons
- [x] Found head wiring in `src/routes/__root.tsx` (theme-color + manifest link + SW register already present)
- [x] Verify all existing icons are valid PNGs at correct sizes

## PWA files
- [ ] Create `public/manifest.json` (canonical, with requested icon filenames)
- [ ] Create `public/icon-512x512.png`
- [ ] Create `public/icon-192x192.png`
- [ ] Keep `public/manifest.webmanifest` in sync
- [ ] Update `sw.js` SHELL precache list
- [ ] Update `__root.tsx` head: link `/manifest.json`, confirm theme-color + SW register

## Verify + deploy
- [ ] Build the app locally to confirm no breakage
- [ ] Push branch, open PR, merge
- [ ] Wait for Lovable auto-deploy
- [ ] Verify live: /manifest.json, /icon-512x512.png, /icon-192x192.png, /sw.js all 200

## PWABuilder
- [ ] Attempt PWABuilder.com packaging for the live URL
- [ ] Report result / hand off with exact steps if it needs login
