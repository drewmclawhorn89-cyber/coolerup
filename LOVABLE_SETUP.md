# What to paste into Lovable

Lovable builds the app, but it does **not** apply database migrations on its own.
The TikTok code is already on `main`; the database still has to be told about it.
That is the only reason nothing has been pulled yet.

Do the three steps below in order. Each one is a single message you send to
Lovable's chat.

---

## Step 1 — Make sure Lovable has the code

Send this first, on its own:

> Sync from GitHub main. The latest commits add a TikTok ingestion feature:
> `src/lib/tiktok.ts`, `src/lib/tiktok.server.ts`, `src/lib/tiktokSync.server.ts`,
> `src/lib/tiktok.functions.ts`, `src/lib/tiktokHeartbeat.ts`,
> `src/components/TikTokSyncPanel.tsx`, `src/routes/api/tiktok/sync.ts`,
> `src/routes/api/tiktok/heartbeat.ts`, plus changes to `src/routes/admin.tsx`,
> `src/routes/__root.tsx` and `src/components/VideoCard.tsx`.
> Confirm those files are present and that the project builds. Do not rewrite or
> "improve" them — they are finished and tested.

Wait for it to confirm the build is clean before continuing.

---

## Step 2 — Apply the database migration

This is the step that has been missing. Send:

> Apply the Supabase migrations `supabase/migrations/20261214000000_tiktok_sync.sql`
> and `supabase/migrations/20261215000000_tiktok_feed.sql` to the connected
> Supabase project. Run them as-is, in that order, through the Supabase
> integration. Do not modify them and do not create new tables instead.
>
> When done, run this verification query and show me the result:
>
> ```sql
> select 'tiktok_sources' as object, case when to_regclass('public.tiktok_sources') is not null then 'ok' else 'MISSING' end as result
> union all select 'tiktok_sync_settings', case when to_regclass('public.tiktok_sync_settings') is not null then 'ok' else 'MISSING' end
> union all select 'tiktok_sync_runs', case when to_regclass('public.tiktok_sync_runs') is not null then 'ok' else 'MISSING' end
> union all select 'videos.is_tiktok', case when exists (select 1 from information_schema.columns where table_schema='public' and table_name='videos' and column_name='is_tiktok') then 'ok' else 'MISSING' end
> union all select 'tiktok_claim_run', case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='tiktok_claim_run') then 'ok' else 'MISSING' end;
> ```

Every row must say `ok`. If any says `MISSING`, tell me which one and the error
text — do not invent a workaround.

---

## Step 3 — Add a source and run it once

Send:

> Insert one TikTok source so the sync has something to pull:
>
> ```sql
> insert into public.tiktok_sources (kind, value, label)
> values ('video', 'REPLACE_WITH_A_REAL_TIKTOK_VIDEO_ID', 'first test clip')
> on conflict (kind, value) do nothing;
> ```
>
> Then call the admin sync server function `runTikTokSyncNow` once and show me
> the returned summary object (status, sourcesChecked, videosAdded,
> videosSkipped, message).

Replace `REPLACE_WITH_A_REAL_TIKTOK_VIDEO_ID` with the number from any
`https://www.tiktok.com/@someone/video/XXXXXXXXXXXXXXX` link.

`videosAdded` should be `1`. If it is `0`, the `message` field says why.

---

## Step 4 — Optional: turn on real 24/7

The app pings `/api/tiktok/heartbeat` on every visit, so ingestion runs whenever
someone uses the app. For true round-the-clock pulling with no visitors, you
need a scheduler, which needs a secret:

> Add a project secret named `LOVABLE_CRON_SECRET` with a long random value, and
> a secret named `TIKTOK_ACCESS_TOKEN` if I give you one. Then set up a scheduled
> job that calls `POST /api/tiktok/sync` every 15 minutes with
> `Authorization: Bearer $LOVABLE_CRON_SECRET`.

`TIKTOK_ACCESS_TOKEN` is what lets the job discover *new* posts from a creator.
Without it, only single-video links work — TikTok blocks anonymous profile
scraping, and the run log will say so rather than pretending to succeed.

---

## What to expect afterwards

Ingested clips land in `videos` with `is_tiktok = true`, which is the vertical
swipe feed at `/`. They are **not** in `/videos` (the horizontal grid) — that is
a different table and a different feature.

Playback goes through TikTok's own embed player inside the feed card. Nothing is
downloaded or rehosted.

Manage everything at `/admin` → **TikTok** tab: on/off, cadence, per-run cap,
auto-publish, source list, and the run log.
