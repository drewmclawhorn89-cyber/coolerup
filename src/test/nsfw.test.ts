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

  it("jumps sexual content straight to a permanent ban", () => {
    expect(sql).toContain("if p_kind = 'sexual' then");
    expect(sql).toMatch(/if p_kind = 'sexual' then\s*\n\s*new_count := 3;/);
  });

  it("still keeps the 3-strike ladder for everything else", () => {
    expect(sql).toContain("new_count := coalesce(row_strike.strike_count, 0) + 1;");
  });

  it("gives sexual bans their own message", () => {
    expect(sql).toContain("explicit sexual content is not allowed on Coolerup");
  });
});
