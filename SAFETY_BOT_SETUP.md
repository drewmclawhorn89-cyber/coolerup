# Coolerup Safety Bot — the only setup that works

## Read this first

Your app is built by **Lovable**. Lovable builds from **its own copy of the project**.
It does **not** automatically pull `drewmclawhorn89-cyber/coolerup` from GitHub, and it
does **not** apply database migrations on its own.

That means every change I merged to `main` — the admin buttons, the sweep, the feed
filters, the server-side triggers — is sitting in **GitHub**, not in **your app**.
That is the entire reason the bot has looked broken. The code is real and it is tested,
but nothing has copied it into the app Lovable builds.

There are two halves, and **both** have to be done:

| Half | Where it lives | How it gets applied |
| --- | --- | --- |
| App code (buttons, filters, pages) | GitHub `main` | You tell Lovable to sync from GitHub |
| Database (tables, triggers, bot account) | `supabase/sql-editor-safety-bot-ALL-IN-ONE.sql` | You run it in the Supabase SQL editor |

If you only do one, it will still look broken. Do both, in order.

---

## Step 1 — Make Lovable pull the code from GitHub

Open your Lovable project, open the chat box, and paste this:

> Sync this project from my GitHub repository `drewmclawhorn89-cyber/coolerup`, branch `main`.
> Pull the latest commit. Then confirm these files exist in the project and that the build
> succeeds with no errors:
> - `src/lib/autoBans.ts`
> - `src/routes/admin.tsx`
> - `src/routes/moderation-check.tsx`
> - `src/lib/loop.ts`
> - `src/lib/search.ts`
> - `src/routes/index.tsx`

Wait for it to finish. If it says it cannot see the repo, connect the GitHub repo in
Lovable's project settings first (Settings → GitHub → Connect), then repeat the prompt.

**You are done with Step 1 when** Lovable says the build is clean and those files are present.

---

## Step 2 — Install the database half

1. Download `supabase/sql-editor-safety-bot-ALL-IN-ONE.sql` from the repo.
2. In Lovable, open the Supabase connection (or go to your Supabase project →
   **SQL Editor**).
3. Paste the **entire** file and run it once.

It is safe to run more than once. It prints a checklist at the end; every row should
say `1`. If you see `SAFETY BOT INCOMPLETE` in the messages, stop and run Step 3.

The file does all of this in one pass:

- creates `moderation_log`, `banned_users`, `user_strikes`, `identity_bans`, `user_devices`, `reports`
- creates the real bot account **Coolerup Safety Bot** (`@coolerup_safety`) with the
  green-check badge and the `moderator` role
- creates `auto_moderate()` — the 1st/2nd/3rd strike ladder
  (warning → 24h mute → permanent ban + device/email/phone block)
- creates `safety_bot_sweep()` and `purge_hidden_videos()`
- installs **6 database triggers** so a bad video, comment, message or bio is stopped
  *at write time*, before it ever renders — this is the part that makes takedowns instant
- exempts **reposts of other people's videos** (they are never flagged)
- exempts **your owner account** (it can never be banned)

---

## Step 3 — Prove it worked

Run `supabase/sql-editor-safety-bot-check.sql` in the same SQL editor. It prints a
table of checks and one final verdict line:

- `ALL CHECKS PASSED` — everything is installed and the triggers actually fire.
- `PROBLEM FOUND` — the failing rows tell you exactly which piece is missing.

This script is safe: it inserts two throwaway videos, checks them, and deletes them.

---

## Step 4 — Clean up anything that was posted before the triggers existed

In the app, sign in as the owner (`@drewmclawhorn3`), open **Admin → AI Bot Logs**, and
press **Clean the app now**. That calls `safety_bot_sweep()` and hides everything that
was posted before Step 2. **Delete hidden videos** then removes them for good.

If the buttons are not there, Step 1 did not take — go back and re-run that prompt.

---

## Step 5 — Test it for real

1. Open `/moderation-check` in the app. It shows whether the bot account, the ladder and
   the triggers are live.
2. Sign in as a **different, non-owner account** and post a video with the caption
   `porn naked sex`.
3. It should vanish immediately and the account should get the **Warning 1/3** popup.
4. Post `my cooking tutorial` from the same account. It must stay visible.

If step 2 works but step 4 does not, the app half (Step 1) is missing.
If step 4 works but step 2 does not, the database half (Step 2) is missing.

---

## Why this kept looking broken

Nothing I shipped was wrong — it was never *installed*. GitHub is where the code is
stored; Lovable is where the app is built; Supabase is where the database lives. Three
separate places. I can only reach GitHub from here. Steps 1 and 2 are the two hand-offs
that only you can trigger, because they happen inside your Lovable and Supabase accounts.

Once both are done, the bot runs on its own: it watches every new video, comment,
message, bio and profile picture, deletes and warns on the first offence, mutes on the
second, and permanently bans plus blocks the device/email/phone on the third — and it
never touches your owner account or reposts.
