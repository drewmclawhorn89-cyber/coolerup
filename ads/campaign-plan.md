# coolerup — Paid Acquisition Plan

**Product:** coolerup — short-video app. *A little more you.*
**Live destination:** https://coolerup.lovable.app
**Positioning:** the anti-perfection feed. Post the video you'd normally delete.
**Brand:** black `#000`, pink `#ff2d55`, display type, no filters.

---

## 0. Read this first — two hard blockers

### Blocker 1: I cannot launch or spend on your behalf
No Meta, TikTok, or Google Ads account is connected to this session. Only GitHub is. So this document is a **complete, ready-to-execute kit** — creatives, copy, targeting, budgets, and click-by-click setup — not a live campaign. To actually run it you either connect an ads account, or you (or whoever runs your ad accounts) executes the steps in §7.

### Blocker 2: no privacy policy page = automatic ad rejection
Meta and TikTok both require a reachable privacy policy URL during ad review. Your app has no `/privacy` route and nothing in `public/`. Every campaign below will be rejected at review until that exists.

This is a 20-minute fix and it is genuinely the first thing to do. Say the word and I'll build `/privacy` and `/terms` pages that match your brand and cover what you actually collect (phone number, email, Apple/Google ID, uploaded video, device data).

### Also: you have a web app, not a store app
There's no App Store or Play Store listing, so **"app install" campaigns are not available**. Every campaign below is a **website traffic / conversion** campaign pointing at `coolerup.lovable.app`. If you want install campaigns later, that requires store listings first.

---

## 1. The one strategic decision

You are not competing with TikTok on content volume. You cannot win that. You are competing on **positioning**: TikTok is where people perform; coolerup is where they post the thing they'd normally delete.

That means your ads should never look like TikTok ads. No dancing, no trending audio, no polish. The ad creative *is* the product demo: it should feel slightly unedited. The moment your ad looks like a TikTok ad, the positioning collapses.

**Creative north star:** every ad should make someone think *"that's the video I didn't post."*

---

## 2. Funnel and what to measure

```
Ad impression → Landing page view → Sign-up (phone / email / Apple) → First video watched → First upload
```

| Stage | Event to fire | Why it matters |
|-------|---------------|----------------|
| Landing | `PageView` | Baseline for CTR and landing quality |
| Sign-up | `CompleteRegistration` | **Primary optimisation event** |
| Watch | `ViewContent` (first video) | Leading indicator of retention |
| Upload | `FirstUpload` (custom) | The real activation metric |

**Optimise for `CompleteRegistration`, not clicks.** Clicks are cheap and meaningless here; you want people who finish the phone/Apple flow.

Without a pixel you're flying blind and every platform will optimise toward the wrong people. Install pixels *before* spending (§6).

---

## 3. Budget

Starter: **$1,500/month (~$50/day)**, split so no single platform eats the whole test.

| Platform | Daily | Monthly | Share | Job |
|----------|-------|---------|-------|-----|
| TikTok | $20 | $600 | 40% | Cheapest reach, native format, best hook testing |
| Meta (FB + IG) | $18 | $540 | 36% | Best conversion signal once pixel matures |
| YouTube | $12 | $360 | 24% | Intent capture — people already searching for TikTok alternatives |

Rules of thumb:
- **Do not spread thinner than this.** $5/day per platform learns nothing.
- Run for a minimum of **7 days** before judging anything. The first 3 days are the algorithm calibrating.
- Expect the first $300–500 to be tuition. That's normal, not failure.

If you can only afford one platform: **TikTok first.** Cheapest creative testing, and the audience is already primed for the format.

---

## 4. TikTok Ads

**Objective:** Traffic (switch to Conversions once the pixel has 50+ sign-ups)
**Placements:** TikTok feed only. Turn off Pangle and Global App Bundle — they're cheap junk traffic.
**Format:** 9:16 video, 15–21s, sound-on assumed but caption everything.

**Ad group structure — 3 ad groups, one variable each:**

| Ad group | Targeting | Purpose |
|----------|-----------|---------|
| A — Broad | US, 18–34, no interest stacking | Let the algorithm find buyers |
| B — Interest | Entertainment, Music, Comedy, Photography, Skateboarding | Intent-adjacent |
| C — Behaviour | "Short video viewers", "Engaged shoppers" | Warm-ish |

**Bidding:** Lowest Cost, no bid cap for the first week. Optimise for "Landing Page View" until pixel data exists, then "Complete Registration".

**Creative:** 3–5 ads per ad group, mixing the 9:16 creatives in `creatives/`. Use hooks H1, H2, H3, H5 from `ad-copy.md`. Never run a single creative — you're testing hooks, not ads.

**Kill rule:** CTR < 0.5% after 1,000 impressions → kill. CPA > 2× target after $30 spend → kill.

---

## 5. Meta (Facebook + Instagram)

**Objective:** Traffic → Conversions (optimise for `CompleteRegistration`)
**Campaign:** Advantage+ or manual CBO, $18/day
**Placements:** Reels + Feed + Stories. **Exclude Audience Network** — it burns budget on accidental taps.

**Ad sets:**

| Ad set | Audience | Note |
|--------|----------|------|
| 1 — Broad | US, 18–34, all genders, no interests | Broad beats interest stacks on Meta now; the algorithm is better at finding people than your assumptions are |
| 2 — Interest | Entertainment, Streaming, Photography, Music | Only if Broad underperforms after 7 days |
| 3 — Retargeting | Site visitors 30d, video viewers 50% | Small budget ($5/day), highest ROAS, run from day 8 |

**Creative:** the 1:1 grid creative for Feed, the 9:16 split creative for Reels/Stories. Meta needs 3+ assets per ad set to exit learning.

**Copy:** primary text, headline, and description from `ad-copy.md` §3. Test headline "A little more you" against "Less perfect. More real." — that's your sharpest split.

**Learning phase warning:** don't touch a Meta ad set for the first 50 conversions or 7 days. Every edit restarts learning. This is the single most common way people waste money on Meta.

---

## 6. Tracking setup (do this before spending a dollar)

**Meta:**
1. Business Settings → Data Sources → Pixels → Create
2. Install base code in `src/routes/__root.tsx` (or via GTM)
3. Fire `CompleteRegistration` inside the auth success handler — `PhoneAuthDialog.tsx` `handleSuccess()` and `EmailAuthForm` `onSuccess` are the exact hook points
4. Verify with Meta Pixel Helper extension

**TikTok:**
1. Ads Manager → Assets → Events → Web Events → create pixel
2. Same install, fire `CompleteRegistration` at the same three points

**Google/YouTube:**
1. Google Ads → Tools → Conversions → create "Sign-up" website conversion
2. Install the global site tag, fire on the same event

**GA4:** install alongside so you have platform-independent truth. Platforms will always over-report their own contribution.

**UTM convention:** see `ad-copy.md` §7. Every ad gets a tagged URL or you will never know what worked.

---

## 7. Launch sequence (day by day)

**Day 0 — unblock**
- [ ] Publish `/privacy` and `/terms` (blocks all review)
- [ ] Create ad accounts if needed (TikTok Ads Manager, Meta Business Suite, Google Ads)
- [ ] Add payment method to each

**Day 1 — track**
- [ ] Install all three pixels
- [ ] Verify `CompleteRegistration` fires on phone, email, and Apple sign-up
- [ ] Confirm events appear in each platform's test view

**Day 2 — build**
- [ ] TikTok: 1 campaign, 3 ad groups, 12 ads (4 hooks × 3 creatives)
- [ ] Meta: 1 campaign, 2 ad sets, 6 ads
- [ ] YouTube: 1 campaign, 2 ad groups (custom intent + affinity)

**Day 3 — go live at 50% budget**
- [ ] TikTok $10/day, Meta $9/day, YouTube $6/day
- [ ] Do not touch anything for 72 hours

**Day 6 — first read**
- [ ] Kill creatives under CTR 0.5%
- [ ] Kill ad sets with zero sign-ups and >$25 spend
- [ ] Double budget on anything with CPA under target

**Day 10 — scale**
- [ ] Full budget on winners
- [ ] Launch retargeting ad set
- [ ] Build lookalike from sign-ups once you have 100+ events

**Day 30 — review**
- [ ] Cut the worst platform entirely, concentrate spend
- [ ] Commission 3 new hooks based on what won

---

## 8. YouTube specifics

YouTube needs **video files**, not images. You have storyboard frames in `creatives/04-stop-scrolling-16x9.png` but you must produce:

- **6s bumper** (unskippable — must land in 1.5s)
- **15s skippable** (hook before the skip button appears at 5s)
- **Vertical 9:16 cut** for Shorts

Full shot-by-shot scripts are in `ad-copy.md` §4. Shoot on a phone. It should look like a user's video, not a commercial — that's the whole brand.

**Targeting:**
- Custom intent keywords: `app like tiktok`, `tiktok alternative`, `short video app`, `apps like tiktok but real`
- Affinity: Social media enthusiasts, Short video viewers
- In-market: Consumer electronics, Social apps

This is the highest-intent traffic of the three platforms. People typing "tiktok alternative" are pre-sold on the category.

---

## 9. "And all" — the other platforms, ranked

| Platform | Verdict | Why |
|----------|---------|-----|
| **Snapchat** | Worth testing at $10/day | Same 9:16 format, cheap, younger skew. Story ads only. |
| **Pinterest** | Skip for now | Search-intent platform; nobody searches for a video app there |
| **X / Twitter** | Skip for now | Cheap impressions, terrible conversion for consumer social |
| **Reddit** | Worth testing small | r/TikTok, r/socialmedia — brutally honest feedback, cheap clicks, but users hate ads |
| **LinkedIn** | No | Wrong audience entirely |
| **AppLovin / Unity** | No | Needs a store app |

Concentrate. Three platforms done properly beats eight done badly.

---

## 10. What "working" looks like

Honest ranges for consumer social apps, not guarantees:

| Metric | Acceptable | Good |
|--------|-----------|------|
| CTR (TikTok) | 0.5–1% | >1.5% |
| CTR (Meta) | 1–2% | >2.5% |
| Landing → sign-up | 3–8% | >10% |
| Cost per sign-up | $2–6 | <$1.50 |
| Sign-up → first upload | 10–20% | >30% |

If cost per sign-up is above $6 after two weeks and three creative rounds, the problem is usually the **landing page**, not the ads. Your sign-up flow now supports phone, email, and Apple — but a first-time visitor landing cold needs to understand the product in under three seconds. That's worth a dedicated pass.

---

## 11. Compliance notes

- **No fake social proof.** Don't say "join millions" — you'd be lying and platforms will catch it.
- **Apple sign-in** must be disclosed in your privacy policy (it shares name and email with you).
- **Phone numbers** are personal data under GDPR/CCPA — your privacy policy must name Twilio/Supabase as processors.
- **No "TikTok" in ad copy as a trademark claim.** Comparative use like "the app that isn't trying to be TikTok" is generally defensible, but don't imply affiliation. Safer: "apps like TikTok" in targeting only, not in the ad itself.
- **Music licensing:** don't use trending commercial audio in paid ads. Use licensed or original audio only — this is the #1 cause of ad rejection on TikTok and Meta.

---

## Files in this kit

```
ads/
├── campaign-plan.md          ← this document
├── ad-copy.md                ← every line of copy, with character counts
├── index.html                ← visual kit, open in a browser
└── creatives/
    ├── 01-less-perfect-more-real-9x16.png   (TikTok, Reels, Stories)
    ├── 02-point-of-view-9x16.png            (TikTok, Reels)
    ├── 03-a-little-more-you-1x1.png         (Meta Feed, IG)
    └── 04-stop-scrolling-16x9.png           (YouTube, Facebook link ads)
```
