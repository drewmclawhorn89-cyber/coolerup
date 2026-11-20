# Restore GIF search with a rotated Giphy key as a real secret

## Findings
- Server proxy `src/lib/giphy.functions.ts` already reads `process.env["GIPHY_API_KEY"]` — correct pattern, matches every other secret in the repo.
- Root cause of the repeated rotations: `.env` was **tracked by git** and `.gitignore` had no `.env` rule.
- Old key `99etiVJS...` was committed in `04a6a46` and only blanked in `de72a8e`. Still in history, which is why Giphy banned it.
- `.env.example` still advertised `VITE_GIPHY_API_KEY`, the insecure variant that gets inlined into the client bundle.
- `nodejs_compat` is enabled in the generated `wrangler.json`, so `process.env` is populated from Worker bindings — the secret will be visible at runtime once set.

## Tasks
- [x] Stop secrets from being committable: add `.env` rules to `.gitignore`
- [x] Untrack `.env` (local file kept, dropped from the index)
- [x] Remove the `VITE_GIPHY_API_KEY` trap from `.env.example`
- [x] Add regression tests guarding the secret boundary (5 new)
- [x] Document the secret setup so the next rotation is a one-liner
- [x] Verify: tsc clean, 698 tests pass, vite build succeeds
- [x] Commit on a new branch, push, open PR

## Remaining (user action, cannot be done from the repo)
- [ ] Set the rotated key as a host secret: `npx wrangler secret put GIPHY_API_KEY`
- [ ] Redeploy so the Worker picks up the binding
