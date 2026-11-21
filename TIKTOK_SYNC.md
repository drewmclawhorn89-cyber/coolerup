# TikTok 24/7 sync

Coolerup pulls TikTok videos into the short-form feed — the `videos` table that
drives the swipe feed on `/` — on a schedule. The job runs on the server, never
in the browser, and it **never downloads or rehosts a TikTok file**. Each row
stores the canonical share URL, and playback happens in TikTok's own embed
player inside the feed card — the same rule the YouTube additions follow.

Ingested rows are marked `is_tiktok = true` and carry `tiktok_id` and
`tiktok_author`. `username` is set to the TikTok creator's handle so the card
labels itself correctly; `user_id` is the Coolerup account that owns the row
and is nullable, so a missing owner never blocks ingestion.

## What it can pull

| Source kind | Example | Discovery |
| --- | --- | --- |
| `video` | `https://www.tiktok.com/@cats/video/7123456789012345678` | always works (public oEmbed) |
| `creator` | `@cats` or `https://www.tiktok.com/@cats` | Display API when `TIKTOK_ACCESS_TOKEN` is set; otherwise the public profile page (often blocked by TikTok) |
| `hashtag` | `#slowmoments` | needs TikTok Research API access; reported as unsupported rather than faked |

Single video links are the dependable path with no credentials. Creator
auto-discovery is what makes the pull truly continuous, and that needs a token
(see below).

## How the 24/7 part works

1. A scheduler calls `POST /api/tiktok/sync` with
   `Authorization: Bearer $LOVABLE_CRON_SECRET`.
2. `tiktok_claim_run()` takes an advisory lock, refuses to start while another
   run is in flight, and refuses to start if the last run was more recent than
   the configured interval (default 15 minutes). So it is safe to fire the
   endpoint every minute.
3. The engine walks the enabled sources, resolves each into videos, skips ids
   already in `videos` (unique partial index on `tiktok_id`), and inserts the
   rest with `is_tiktok = true`.
4. A row is written to `tiktok_sync_runs`, which the admin panel renders.

### If there is no cron secret (the common case)

`/api/tiktok/sync` answers `500 Server configuration error` whenever
`LOVABLE_CRON_SECRET` is unset, so a deployment without it silently never pulls
anything. Two fallbacks exist so the job still runs:

- **`GET /api/tiktok/heartbeat`** — unauthenticated on purpose. It asks the
  database "is a run due?" and lets `tiktok_claim_run()` decide. A stranger
  cannot make it run more often than `interval_minutes`, because the throttle
  lives in Postgres, not in the request. It is also throttled per server
  instance to one attempt a minute.
- **The app pings it on load.** `src/lib/tiktokHeartbeat.ts` fires the request
  once per browser per 10 minutes, fire-and-forget, from the root component.
  Any traffic at all therefore keeps ingestion alive without a scheduler.

Neither fallback is a substitute for a real scheduler on a quiet site — with no
visitors nothing pings. Set the secret and point a cron at `/api/tiktok/sync`
if the app has low traffic.

## Setup

### 1. Run the SQL

Easiest path: paste `supabase/sql-editor-tiktok-setup.sql` into the Supabase SQL
Editor and run it. It is idempotent, creates every table/index/policy/function,
and ends with an `ok`/`MISSING` report so you can see what took.

The equivalent migrations are `20261214000000_tiktok_sync.sql` (job tables) and
`20261215000000_tiktok_feed.sql` (provenance columns on `videos`), for
`supabase db push`.

### 2. Set the cron secret

`LOVABLE_CRON_SECRET` already exists for other scheduled jobs. If it is not set:

```sh
npx wrangler secret put LOVABLE_CRON_SECRET
```

### 3. (Optional but recommended) Add a TikTok access token

Creator auto-discovery uses the official Display API:

1. Create an app at <https://developers.tiktok.com/> with the **Display API**
   product and the `video.list` scope.
2. Authorise the TikTok account whose videos you want to mirror.
3. Store the user access token as a server secret — never with a `VITE_` prefix,
   because those are inlined into the browser bundle:

```sh
npx wrangler secret put TIKTOK_ACCESS_TOKEN
```

The token lists the videos of the account that authorised it. The sync detects
a mismatch (watching `@someoneelse` with a token for `@you`) and records that in
the source's `last_error` instead of syncing the wrong account.

### 4. Schedule it

Pick one:

**Cloudflare Cron Trigger** (`wrangler.jsonc`):

```jsonc
{
  "triggers": { "crons": ["*/5 * * * *"] }
}
```

and in the Worker's `scheduled` handler, `fetch` the app URL:

```ts
await fetch(`${env.APP_URL}/api/tiktok/sync`, {
  method: "POST",
  headers: { authorization: `Bearer ${env.LOVABLE_CRON_SECRET}` },
});
```

**GitHub Actions** — free and no extra host. Add `APP_URL` and
`LOVABLE_CRON_SECRET` as repository secrets, then a workflow that runs every 15
minutes:

```yaml
on:
  schedule: [{ cron: "*/15 * * * *" }]
  workflow_dispatch:
jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - run: |
          curl -fsS -X POST \
            -H "Authorization: Bearer ${{ secrets.LOVABLE_CRON_SECRET }}" \
            "${{ secrets.APP_URL }}/api/tiktok/sync"
```

**Lovable cron** — point it at `/api/tiktok/sync` with the same bearer header.

### 5. Add sources

Open `/admin` → **TikTok** tab. Paste a creator handle, a single video link, or a
hashtag, then press **Sync now** to pull immediately.

Settings on that panel:

- **Keep pulling** — master switch for the cron path.
- **Publish automatically** — off means new rows land as `draft` and stay out of
  the public grid until published.
- **Minutes between runs** — the real cadence, enforced by the database.
- **Videos per source** — per-run cap so one prolific creator cannot flood the feed.

## Operational notes

- Every failure is per source. One blocked creator records `last_error` and the
  rest of the sources still sync.
- Rows are deduped by `tiktok_id`, so adding the same creator twice, or a creator
  plus one of their videos, cannot produce duplicates.
- If TikTok starts serving login walls, the source says so in the panel. That is
  the signal to add a Display API token rather than to retry harder.
- Nothing here bypasses a block. We use the endpoints TikTok publishes for
  embedding and its official API; we do not scrape around a challenge.
