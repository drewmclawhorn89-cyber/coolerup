import { describe, expect, it, vi } from "vitest";

/**
 * The classifier is the front door of the 3-strike ladder: if it misses a
 * threat or fires on a harmless caption, the whole feature is wrong. These
 * tests pin the ordering (threat beats sexual beats bullying beats spam), the
 * leetspeak folding, and the spam heuristics.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    rpc: async () => ({ data: null, error: null }),
  },
}));

import { classifyText } from "@/lib/autoBans";

describe("classifyText", () => {
  it("returns null for clean text", () => {
    expect(classifyText("beach day with the crew")).toBeNull();
    expect(classifyText("")).toBeNull();
    expect(classifyText(null)).toBeNull();
    expect(classifyText(undefined)).toBeNull();
  });

  it("flags explicit sexual content", () => {
    const hit = classifyText("link in bio for my onlyfans");
    expect(hit?.kind).toBe("sexual");
  });

  it("flags bullying and slurs", () => {
    const hit = classifyText("you are such a loser, nobody likes you");
    expect(hit?.kind).toBe("bullying");
  });

  it("flags a direct threat", () => {
    const hit = classifyText("i will kill you if you post that again");
    expect(hit?.kind).toBe("threat");
  });

  it("ranks a threat above sexual wording in the same text", () => {
    const hit = classifyText("send nudes or i will kill you");
    expect(hit?.kind).toBe("threat");
  });

  it("folds leetspeak before matching", () => {
    expect(classifyText("g0 send nud3s")?.kind).toBe("sexual");
    expect(classifyText("1 w1ll k1ll y0u")?.kind).toBe("threat");
  });

  it("flags obvious spam phrases", () => {
    expect(classifyText("follow for follow, f4f everyone")?.kind).toBe("spam");
  });

  it("flags link floods as spam", () => {
    const hit = classifyText("https://a.test https://b.test https://c.test");
    expect(hit?.kind).toBe("spam");
  });

  it("flags a money link as spam", () => {
    const hit = classifyText("free crypto giveaway https://scam.test");
    expect(hit?.kind).toBe("spam");
  });

  it("does not flag one ordinary link", () => {
    expect(classifyText("my new video https://youtube.com/watch?v=abc")).toBeNull();
  });

  it("does not fire on innocent words that contain a bad one", () => {
    // These all matched before matching became word-exact.
    expect(classifyText("cooking analysis video")).toBeNull();
    expect(classifyText("spicy noodles recipe")).toBeNull();
    expect(classifyText("my trip to pakistan")).toBeNull();
    expect(classifyText("cocktail recipe")).toBeNull();
    expect(classifyText("analog camera shots")).toBeNull();
    expect(classifyText("documentary about space")).toBeNull();
  });

  it("catches the common insults and explicit words people actually use", () => {
    expect(classifyText("you are a stupid bitch")?.kind).toBe("bullying");
    expect(classifyText("idiot")?.kind).toBe("bullying");
    expect(classifyText("shut up")?.kind).toBe("bullying");
    expect(classifyText("nobody likes you")?.kind).toBe("bullying");
    expect(classifyText("explicit content")?.kind).toBe("sexual");
    expect(classifyText("boobs")?.kind).toBe("sexual");
    expect(classifyText("horny")?.kind).toBe("sexual");
    expect(classifyText("buy followers cheap")?.kind).toBe("spam");
    expect(classifyText("dm me")?.kind).toBe("spam");
    expect(classifyText("link in bio")?.kind).toBe("spam");
  });

  it("still prefix-matches the entries that ask for it", () => {
    expect(classifyText("stop masturbating")?.kind).toBe("sexual");
  });

  it("returns matches for the admin log", () => {
    const hit = classifyText("this is porn");
    expect(hit?.matches.length).toBeGreaterThan(0);
    expect(hit?.reason).toContain("porn");
  });
});
