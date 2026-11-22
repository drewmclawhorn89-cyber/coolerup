import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { judgePredictions, type Prediction } from "@/lib/nsfw";

/**
 * The visual check is what catches a silent naked video with a clean caption,
 * so its decision rule needs to be pinned: real porn bans, "sexy" on its own
 * does not, and a mixed frame is judged on the strongest signal.
 */

function preds(porn = 0, hentai = 0, sexy = 0, neutral = 0): Prediction[] {
  return [
    { className: "Porn", probability: porn },
    { className: "Hentai", probability: hentai },
    { className: "Sexy", probability: sexy },
    { className: "Neutral", probability: neutral },
    { className: "Drawing", probability: 0 },
  ];
}

describe("judgePredictions", () => {
  it("bans a clearly pornographic frame", () => {
    const v = judgePredictions(preds(0.94, 0.01, 0.04, 0.01), 8);
    expect(v.explicit).toBe(true);
    expect(v.label).toBe("Porn");
    expect(v.score).toBeCloseTo(0.94);
  });

  it("bans explicit anime", () => {
    const v = judgePredictions(preds(0.02, 0.88, 0.05, 0.05), 8);
    expect(v.explicit).toBe(true);
    expect(v.label).toBe("Hentai");
  });

  it("does not ban a beach photo that only reads as sexy", () => {
    const v = judgePredictions(preds(0.05, 0.01, 0.9, 0.04), 1);
    expect(v.explicit).toBe(false);
  });

  it("does not ban a neutral frame", () => {
    const v = judgePredictions(preds(0.01, 0, 0.08, 0.91), 8);
    expect(v.explicit).toBe(false);
    expect(v.label).toBe("Neutral");
  });

  it("counts sexy + a real porn signal as explicit", () => {
    const v = judgePredictions(preds(0.3, 0, 0.9, 0.05), 8);
    expect(v.explicit).toBe(true);
  });

  it("keeps the frame count for the admin log", () => {
    expect(judgePredictions(preds(0, 0, 0, 1), 8).frames).toBe(8);
  });
});

describe("auto_moderate SQL", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/sql-editor-auto-bans.sql"), "utf8");

  it("does NOT jump sexual content straight to a permanent ban", () => {
    // The Safety Bot ladder treats every violation kind the same: 1st warning,
    // 2nd 24h mute, 3rd permanent ban. Sexual content is no longer an instant
    // ban, so the old shortcut must be gone.
    expect(sql).not.toContain("if p_kind = 'sexual' then");
  });

  it("climbs the 3-strike ladder for every kind", () => {
    expect(sql).toContain("new_count := coalesce(row_strike.strike_count, 0) + 1;");
    expect(sql).toContain("Warning 1/3");
    expect(sql).toContain("Warning 2/3");
    expect(sql).toContain("Warning 3/3");
  });

  it("never bans the owner or an admin", () => {
    expect(sql).toContain("public.is_owner_uid(p_user_id)");
    expect(sql).toContain("target_is_owner");
    expect(sql).toContain("target_is_admin");
  });
});

describe("real Safety Bot account SQL", () => {
  const sql = readFileSync(resolve(process.cwd(), "supabase/sql-editor-bot-account.sql"), "utf8");

  it("creates a real auth user and profile for the bot", () => {
    expect(sql).toContain("insert into auth.users");
    expect(sql).toContain("insert into public.profiles");
    expect(sql).toContain("'coolerup_safety'");
    expect(sql).toContain("'Coolerup Safety Bot'");
  });

  it("gives the bot a real moderator role, not admin", () => {
    expect(sql).toContain("'moderator'::public.app_role");
    expect(sql).not.toContain("values (bot_uid, 'admin'::public.app_role)");
  });

  it("cannot be signed into: the password is random", () => {
    expect(sql).toContain("$2a$10$");
  });

  it("exposes a bot uid and refuses to moderate the bot", () => {
    expect(sql).toContain("public.safety_bot_uid()");
    expect(sql).toContain("public.is_safety_bot_uid(p_user_id)");
    expect(sql).toContain("target_is_bot");
  });

  it("records which real account acted", () => {
    expect(sql).toContain("add column if not exists actor_id uuid");
    expect(sql).toContain("public.safety_bot_uid(), true, p_reason");
  });

  it("ships the bot's own takedown path", () => {
    expect(sql).toContain("create or replace function public.bot_takedown(");
    expect(sql).toContain("not_authorized");
  });
});

/**
 * The Safety Bot used to run only in the browser, after the row was already
 * written. Anything that skipped that path (TikTok sync, a repost, a direct
 * API call, or a classifier that failed to load) stayed live. These tests pin
 * the database-side enforcement that closed that hole, so it cannot quietly
 * regress back to client-only moderation.
 */
describe("instant takedown SQL", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/sql-editor-instant-takedown.sql"),
    "utf8",
  );

  it("hides videos at write time instead of deleting them", () => {
    expect(sql).toContain("add column if not exists hidden boolean not null default false");
    expect(sql).toContain("new.hidden := true");
    expect(sql).toContain("new.hidden_by := 'Coolerup Safety Bot'");
  });

  it("enforces on insert and on caption edits", () => {
    expect(sql).toContain("before insert on public.videos");
    expect(sql).toContain("before update of caption on public.videos");
  });

  it("refuses to store a bad comment or message at all", () => {
    expect(sql).toContain("before insert on public.comments");
    expect(sql).toContain("before insert on public.messages");
    // `return null` in a BEFORE INSERT trigger cancels the write entirely.
    expect(sql).toContain("return null");
  });

  it("blanks a bad bio but keeps the account", () => {
    expect(sql).toContain("before update of bio, display_name on public.profiles");
    expect(sql).toContain("before insert on public.profiles");
    expect(sql).toContain("'[removed by Coolerup]'");
  });

  it("never touches reposts of other people's videos", () => {
    expect(sql).toContain("new.source_id is not null");
    expect(sql).toContain("new.is_tiktok");
  });

  it("never touches the owner", () => {
    expect(sql).toContain("public.is_owner_uid");
  });

  it("ships a sweep for content that predates the triggers", () => {
    expect(sql).toContain("create or replace function public.safety_bot_sweep()");
    expect(sql).toContain("videos_hidden");
    expect(sql).toContain("create or replace function public.purge_hidden_videos()");
  });

  it("hides moderated rows from the app even if a query forgets to filter", () => {
    expect(sql).toContain('create policy "hide moderated videos"');
    expect(sql).toContain("as restrictive");
    expect(sql).toContain("using (not hidden)");
  });

  it("classifies the same violations the app does", () => {
    for (const kind of ["threat", "sexual", "bullying", "pii", "fake", "spam"]) {
      expect(sql).toContain(`'${kind}'`);
    }
  });
});

/**
 * The user pastes ONE file into the SQL Editor, so its internal order is a
 * real correctness constraint: Part 1 creates the tables, Part 2 creates the
 * bot and safety_bot_uid(), Part 3's logger depends on both. Getting that
 * order wrong produces a half-installed database, which is exactly the
 * failure mode we already hit twice.
 */
describe("all-in-one SQL paste file", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/sql-editor-safety-bot-ALL-IN-ONE.sql"),
    "utf8",
  );

  it("puts the parts in dependency order", () => {
    const bans = sql.indexOf("PART 1 of 3");
    const bot = sql.indexOf("PART 2 of 3");
    const takedown = sql.indexOf("PART 3 of 3");
    expect(bans).toBeGreaterThan(-1);
    expect(bot).toBeGreaterThan(bans);
    expect(takedown).toBeGreaterThan(bot);
  });

  it("creates safety_bot_uid() before anything that calls it", () => {
    const def = sql.indexOf("function public.safety_bot_uid()");
    expect(def).toBeGreaterThan(-1);
    // The logger in Part 3 and the final checklist both call it, so the
    // definition has to land first or the paste fails half-way.
    expect(def).toBeLessThan(sql.indexOf("PART 3 of 3"));
    expect(def).toBeLessThan(sql.indexOf("from auth.users u where u.id = public.safety_bot_uid()"));
  });

  it("does not use '#' as a comment, which Postgres rejects", () => {
    const offenders = sql
      .split("\n")
      .filter((line) => /^\s*#/.test(line) && !/^\s*#\s*$/.test(line));
    expect(offenders).toEqual([]);
  });

  it("guards optional auth tables instead of assuming they exist", () => {
    expect(sql).toContain("to_regclass('auth.instances')");
    expect(sql).toContain("to_regclass('auth.identities')");
  });

  it("prints a checklist so a silent half-install is visible", () => {
    expect(sql).toContain("bot: auth.users row");
    expect(sql).toContain("bot: moderator role");
    expect(sql).toContain("SAFETY BOT: all good");
  });
});

/**
 * The check-up has to survive the exact situation it exists for: a database
 * where the bot is only half installed. A direct call to a missing function
 * or table would abort the whole script and print nothing, which is how the
 * last two rounds of "it didn't work" went undiagnosed.
 */
describe("safety bot check-up SQL", () => {
  const sql = readFileSync(
    resolve(process.cwd(), "supabase/sql-editor-safety-bot-check.sql"),
    "utf8",
  );

  it("does not call safety_bot_uid() directly", () => {
    expect(sql).toContain("if to_regprocedure('public.safety_bot_uid()') is null");
    expect(sql).toContain("execute 'select public.safety_bot_uid()'");
  });

  it("checks tables exist before counting them", () => {
    expect(sql).toContain("to_regclass('public.' || t)");
  });

  it("proves the trigger fires with a live insert, then cleans up", () => {
    expect(sql).toContain("zz_safety_probe");
    expect(sql).toContain("LIVE TEST bad video");
    expect(sql).toContain("delete from public.videos where id = probe");
  });

  it("checks a clean caption is not a false positive", () => {
    expect(sql).toContain("LIVE TEST clean video");
  });

  it("ends with a single verdict line", () => {
    expect(sql).toContain("ALL CHECKS PASSED");
    expect(sql).toContain("PROBLEM FOUND");
  });
});
