# 24/7 licensed video ingestion (Pexels)

Coolerup pulls **real, licensed short videos** into the swipe feed on `/` on a
schedule. This is the sibling of `TIKTOK_SYNC.md`, with one deliberate
difference: Pexels licenses its library for free commercial use and rehosting,
so this job **does** download the MP4 and serve it from our own `videos`
bucket. Nothing here scrapes or rehosts TikTok.

The TikTok job stays as it is: embed-only, no file transfer. This job is for
material we are allowed to own a copy of.

## What a row looks like

Ingested rows land in `public.videos`, the same table that drives the feed:

| Column | Value |
| --- | --- |
| `video_url` | `storage:pexels/<id>.mp4` — our bucket, played by `<video>` |
| `user_id` / `username` | the owning Coolerup account (defaults to `@drewmclawhorn3` once pinned) |
| `caption` | `Video by <author> on Pexels · <n>s` |
| `source_provider` | `pexels` |
| `source_id` | Pexels video id — the dedupe key |
| `source_url` | the Pexels page |
| `source_author` | the filmmaker's name |
| `rights_basis` | `pexels_license` |
| `hidden` | `false` when auto-publish is on |

The feed card labels the post with the owning account, and the caption plus
`source_author` keep the real filmmaker visible. Attribution is never rewritten
away.

## How the 24/7 part works

1. A scheduler calls `POST /api/pexels/sync` with
   `Authorization: Bearer $LOVABLE_CRON_SECRET`.
2. `pexels_claim_run()` takes an advisory lock (a different key from the TikTok
   job), refuses to start while another run is in flight, and refuses to start
   if the last run was more recent than `interval_minutes` (default 15). Firing
   the endpoint every minute is therefore harmless.
3. The engine walks enabled sources, skips ids already in `videos`, downloads
   the best MP4, uploads it to `videos/pexels/<id>.mp4`, and inserts the row.
4. A row is written to `pexels_sync_runs` with counts and any notes.

### Fallbacks when there is no scheduler

- `GET /api/pexels/heartbeat` — unauthenticated by design. It asks the database
  "is a run due?" and lets `pexels_claim_run()` decide. A stranger cannot make
  it run more often than the configured interval because the throttle lives in
  Postgres. `?probe=1` reports whether `PEXELS_API_KEY` is present.
- A per-instance throttle keeps a burst of page loads to one database round
  trip per minute.

## Setup

### 1. Get a key

Create a free account at <https://www.pexels.com/api/> and copy the API key.
The default allowance is 200 requests/hour and 20,000/month; the client keeps a
token bucket at 180/hour and each run makes at most one request per source, so
the default 15-minute cadence uses roughly 8 requests/hour.

### 2. Run the SQL

Paste `supabase/sql-editor-pexels-setup.sql` into the Supabase SQL Editor. It is
idempotent: it adds the provenance columns, the unique dedupe index, the three
job tables, the claim function, and seeds two sources (`popular`, `vertical`).

The equivalent migration is `20261216000000_pexels_sync.sql`.

### 3. Set the secrets

```sh
npx wrangler secret put PEXELS_API_KEY
npx wrangler secret put LOVABLE_CRON_SECRET   # if not already set
```

`PEXELS_API_KEY` must never carry a `VITE_` prefix — those are inlined into the
browser bundle.

### 4. Pin the owner (optional)

Ingested rows default to the oldest admin/owner in `user_roles`. To pin them to
`@drewmclawhorn3` explicitly:

```sql
update public.pexels_sync_settings
   set owner_user_id = (select id from public.profiles where lower(handle) = 'drewmclawhorn3')
 where id = 1;
```

### 5. Schedule it

`.github/workflows/pexels-sync.yml` runs every 15 minutes. Add `APP_URL` and
`LOVABLE_CRON_SECRET` as repository secrets. Any scheduler works — the endpoint
is idempotent.

### 6. Add sources

```sql
insert into public.pexels_sources (kind, value, label)
values ('search', 'city night', 'Night city')
on conflict (kind, value) do nothing;
```

`kind` is `popular` or `search`; `value` is the search term (use `popular` for
the curated feed). Disable a source with `update ... set enabled = false`.

Settings live in `pexels_sync_settings` (single row):

- `enabled` — master switch for the cron path.
- `interval_minutes` — real cadence, enforced in the database.
- `max_per_source` — per-source cap per run.
- `max_per_run` — hard ceiling per run, so a bad query cannot drain the quota.
- `auto_publish` — off means rows land `hidden` for review.

## Reliability

- **Rate limiting.** Token bucket at 180 requests/hour with a hard wait when
  empty. Pexels' 429 responses are honoured via `Retry-After`.
- **Retries.** 429, 5xx, timeouts and network failures retry up to 4 attempts
  with exponential backoff and full jitter (capped at 20s). A 401/403 is *not*
  retried — a bad key will not fix itself.
- **Timeouts.** 15s per API request, 90s per download, so a hung socket cannot
  wedge a run.
- **Dedupe before download.** The `(source_provider, source_id)` lookup runs
  before any file transfer; the unique index is the real guard against races.
- **No orphaned files.** The object key is derived from the Pexels id and
  uploaded with `upsert: true`, so a retry overwrites the same object. If the
  row insert fails for a non-duplicate reason, the object is removed.
- **Per-source isolation.** One failing query records `last_error` and the rest
  still sync. A missing or rejected key stops the run early, because every
  source would fail the same way.
- **Size ceiling.** Files over 120 MB are skipped rather than stored.

## Appendix: the cron workflow

The automation token used to open this PR cannot write `.github/workflows/`,
so add this file yourself (or paste it in the GitHub UI at
**Actions → New workflow**). It runs every 15 minutes:

```yaml
name: Pexels sync
on:
  schedule:
    - cron: "*/15 * * * *"
  workflow_dispatch:
concurrency:
  group: pexels-sync
  cancel-in-progress: false
jobs:
  sync:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - name: Trigger sync
        env:
          APP_URL: ${{ secrets.APP_URL }}
          CRON_SECRET: ${{ secrets.LOVABLE_CRON_SECRET }}
        run: |
          set -euo pipefail
          curl -fsS -X POST \
            -H "Authorization: Bearer ${CRON_SECRET}" \
            "${APP_URL%/}/api/pexels/sync"
```

Add `APP_URL` and `LOVABLE_CRON_SECRET` under **Settings → Secrets and
variables → Actions**. Any other scheduler (Cloudflare Cron Trigger, Lovable
cron, a systemd timer) works too — the endpoint is idempotent.
