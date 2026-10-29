# coolerup — paid acquisition kit

Everything needed to put coolerup in front of people on TikTok, Meta (Facebook +
Instagram), YouTube and Snapchat. This folder is documentation and creative
assets only — it contains no application code and is not imported by the app.

## What's here

| File | What it is |
| --- | --- |
| `index.html` | A single-file visual kit you can open in a browser (or deploy as a static page). Shows the strategy, funnel, creatives, copy, budget and launch checklist in one scroll. |
| `campaign-plan.md` | The full written plan: strategy, funnel, budget split, per-platform targeting, kill rules, tracking setup, and a day 0 → day 30 launch sequence. |
| `ad-copy.md` | Every piece of copy, per platform, with character counts verified against each platform's limits. Includes the UTM scheme. |
| `creatives/` | Four finished ad frames in the correct aspect ratios. |

## Creatives

| File | Ratio | Placement |
| --- | --- | --- |
| `01-less-perfect-more-real-9x16.png` | 9:16 | TikTok / Reels / Shorts in-feed |
| `02-point-of-view-9x16.png` | 9:16 | TikTok / Reels / Shorts in-feed |
| `03-a-little-more-you-1x1.png` | 1:1 | Meta feed, Snapchat |
| `04-stop-scrolling-16x9.png` | 16:9 | YouTube in-stream |

## Two things that block a live campaign

1. **No privacy policy URL.** Meta and TikTok both reject ad review without a
   reachable privacy policy. The app has no `/privacy` or `/terms` route yet.
   This is the single highest-leverage fix before spending anything.
2. **No App Store / Play listing.** coolerup is a web app
   (https://coolerup.lovable.app), so app-install campaigns are not available.
   All campaigns here are traffic campaigns pointed at the web app — which is
   cheaper anyway, but it means the landing page has to explain the product in
   under three seconds.

## How to run a campaign

1. Publish `/privacy` and `/terms`.
2. Install the pixels (`CompleteRegistration` on sign-up success) — see the
   tracking section of `campaign-plan.md`.
3. Start with the TikTok campaign only, at the daily budget in the plan.
4. Kill any creative that is below the thresholds in the kill rules after 3 days.
5. Only scale what survives, and only then add Meta and YouTube.

## Budget

The plan is built around **$1,500/month** total:

- TikTok — $20/day
- Meta (Facebook + Instagram) — $18/day
- YouTube — $12/day

Change the numbers in `campaign-plan.md` if your budget differs; the structure
and kill rules stay the same.
