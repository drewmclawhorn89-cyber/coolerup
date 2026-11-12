"""Generates the bulk subscription-code seed SQL.

Run: python3 scripts/gen_codes.py > /tmp/codes.sql
"""
import random
import string

OWNER = "@drewmclawhorn3"
rows = []  # (code, plan, months, max_uses, expires_at, note)


def add(code, plan, months, max_uses, expires_at=None, note=""):
    rows.append((code, plan, months, max_uses, expires_at, note))


# ---------------------------------------------------------------- owner / comp
add("DREW-FREE", "premium", 12, 1, None, "owner comp, 1 year premium")
add("DREW-VIP", "premium", 12, 1, None, "owner comp")
add("DREW-BASIC", "basic", 12, 1, None, "owner comp")
add("COOLERUP-FREE", "premium", 1, 100, None, "main promo")
add("COOLERUP-FREE-1M", "premium", 1, 100, None, "main promo alt")
add("COOLERUP-FREE-3M", "premium", 3, 100, None, "3 month promo")
add("COOLERUP-FREE-1Y", "premium", 12, 50, None, "1 year promo")
add("COOLERUP-BASIC", "basic", 1, 500, None, "basic promo")
add("COOLERUP-BASIC-3M", "basic", 3, 250, None, "basic 3mo")
add("COOLERUP-BASIC-1Y", "basic", 12, 100, None, "basic 1yr")
add("COOLERUP-VIP", "premium", 3, 50, None, "vip 3mo")
add("WELCOME", "basic", 1, 1000, None, "onboarding")
add("WELCOME-BACK", "basic", 1, 500, None, "winback")
add("THANKYOU", "basic", 3, 200, None, "support thank you")
add("BETA-TESTER", "premium", 3, 300, None, "beta crew")
add("OG-CREATOR", "premium", 12, 25, None, "founding creators")
add("EARLY-BIRD", "premium", 1, 250, None, "early bird")

# ------------------------------------------------------------------- seasonal
add("CHRISTMAS-2026", "basic", 1, 1000, "2026-12-31 23:59:59+00", "christmas update")
add("XMAS-2026", "premium", 1, 500, "2026-12-31 23:59:59+00", "christmas premium")
add("HOLIDAY-2026", "premium", 3, 200, "2027-01-15 23:59:59+00", "holiday season")
add("NEWYEAR-2027", "premium", 1, 1000, "2027-01-31 23:59:59+00", "new year")
add("VALENTINES-2027", "basic", 1, 500, "2027-02-28 23:59:59+00", "valentines")
add("SPRING-2027", "basic", 1, 500, "2027-05-31 23:59:59+00", "spring")
add("SUMMER-2027", "premium", 3, 300, "2027-08-31 23:59:59+00", "summer")
add("HALLOWEEN-2027", "premium", 1, 500, "2027-11-01 23:59:59+00", "halloween")
add("BLACKFRIDAY-2027", "premium", 12, 100, "2027-12-01 23:59:59+00", "black friday")
add("CYBERMONDAY-2027", "premium", 3, 200, "2027-12-05 23:59:59+00", "cyber monday")
add("BACKTOSCHOOL-2027", "basic", 3, 300, "2027-09-30 23:59:59+00", "back to school")
add("BIRTHDAY-2027", "premium", 1, 200, "2027-12-31 23:59:59+00", "coolerup birthday")

# ---------------------------------------------------------------- milestones
add("MILESTONE-1K", "basic", 1, 100, None, "1k users")
add("MILESTONE-10K", "premium", 1, 200, None, "10k users")
add("MILESTONE-100K", "premium", 3, 300, None, "100k users")
add("MILESTONE-1M", "premium", 12, 500, None, "1m users")
add("LAUNCH-DAY", "premium", 1, 1000, None, "launch")
add("ANNIVERSARY-1", "premium", 1, 500, None, "1 year anniversary")

# ------------------------------------------------------------- support / fix
add("SORRY-1M", "premium", 1, 100, None, "outage apology")
add("SUPPORT-CREDIT", "basic", 1, 100, None, "support credit")
add("REFUND-CREDIT", "premium", 1, 100, None, "refund replacement")
add("BUG-BOUNTY", "premium", 12, 50, None, "bug hunters")
add("MOD-TEAM", "premium", 12, 30, None, "moderators")
add("STAFF", "premium", 12, 20, None, "staff")

# ------------------------------------------------------------- creator perks
add("CREATOR-1M", "premium", 1, 100, None, "creator perk")
add("CREATOR-3M", "premium", 3, 100, None, "creator perk")
add("CREATOR-1Y", "premium", 12, 50, None, "creator perk")
add("STREAMER", "premium", 3, 100, None, "streamers")
add("PARTNER", "premium", 12, 50, None, "partners")
add("AFFILIATE-1M", "basic", 1, 300, None, "affiliates")

# ------------------------------------------------------- 1/3/12 month matrix
for plan in ("basic", "premium"):
    for months, suffix in ((1, "1M"), (3, "3M"), (12, "1Y")):
        for uses, tag in ((1, "SINGLE"), (100, "PROMO"), (1000, "MEGA")):
            add(f"COOLERUP-{plan.upper()}-{suffix}-{tag}", plan, months, uses, None,
                f"{plan} {months}mo {tag.lower()}")

# --------------------------------------------------------- bulk giveaway codes
# 60 unique single-use codes for giveaways / DMs.
rng = random.Random(20261123)
ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # no I/O/0/1 to avoid confusion
seen = set()
while len(seen) < 60:
    part = "".join(rng.choice(ALPHABET) for _ in range(4))
    part2 = "".join(rng.choice(ALPHABET) for _ in range(4))
    code = f"COOLERUP-{part}-{part2}"
    if code in seen:
        continue
    seen.add(code)
    add(code, "premium", 1, 1, None, "giveaway single-use")

# ------------------------------------------------------------------- render
def lit(value):
    if value is None:
        return "null"
    return "'" + str(value).replace("'", "''") + "'"


lines = []
lines.append("-- ---------------------------------------------------------------------------")
lines.append("-- Bulk subscription codes")
lines.append("--")
lines.append(f"-- {len(rows)} codes. Safe to re-run: every insert is ON CONFLICT DO NOTHING,")
lines.append("-- so existing codes keep their uses_count and are left untouched.")
lines.append("--")
lines.append("-- Requires the tables + functions from")
lines.append("-- supabase/migrations/20261123000000_subscription_codes.sql to exist first.")
lines.append("-- ---------------------------------------------------------------------------")
lines.append("")
lines.append("insert into public.subscription_codes")
lines.append("  (code, plan, months, max_uses, expires_at, created_by, active)")
lines.append("values")
body = []
for code, plan, months, max_uses, expires_at, note in rows:
    body.append(
        f"  ({lit(code)}, {lit(plan)}, {months}, {max_uses}, {lit(expires_at)}, {lit(OWNER)}, true)"
    )
lines.append(",\n".join(body))
lines.append("on conflict (code) do nothing;")
lines.append("")
lines.append("-- Sanity check")
lines.append("select count(*) as total_codes,")
lines.append("       count(*) filter (where active) as active_codes,")
lines.append("       count(*) filter (where plan = 'premium') as premium_codes,")
lines.append("       count(*) filter (where plan = 'basic') as basic_codes,")
lines.append("       sum(max_uses) as total_redemptions_available")
lines.append("from public.subscription_codes;")
lines.append("")

print("\n".join(lines))
