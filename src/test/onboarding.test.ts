import { describe, expect, it } from "vitest";
import {
  ageFromBirthday,
  normalizeUsername,
  profileNeedsOnboarding,
  validateBirthday,
  validateUsername,
} from "@/lib/auth";

describe("normalizeUsername", () => {
  it("strips @ and lowercases", () => {
    expect(normalizeUsername("  @DrewMcLawhorn3 ")).toBe("drewmclawhorn3");
  });
});

describe("validateUsername", () => {
  it("accepts a normal username", () => {
    expect(validateUsername("drewmclawhorn")).toEqual({ ok: true, value: "drewmclawhorn" });
  });

  it("accepts dots and underscores", () => {
    expect(validateUsername("cool.name_99").ok).toBe(true);
  });

  it("rejects too-short names", () => {
    const r = validateUsername("ab");
    expect(r.ok).toBe(false);
  });

  it("rejects spaces and symbols", () => {
    expect(validateUsername("bad name").ok).toBe(false);
    expect(validateUsername("bad!name").ok).toBe(false);
  });

  it("rejects leading/trailing separators", () => {
    expect(validateUsername("_drew").ok).toBe(false);
    expect(validateUsername("drew.").ok).toBe(false);
  });

  it("rejects reserved usernames", () => {
    expect(validateUsername("drewmclawhorn3").ok).toBe(false);
    expect(validateUsername("coolerup").ok).toBe(false);
  });

  it("lets the owner keep their own reserved handle", () => {
    expect(validateUsername("drewmclawhorn3", "drewmclawhorn3").ok).toBe(true);
  });

  it("rejects bot-looking names", () => {
    expect(validateUsername("bot095").ok).toBe(false);
    expect(validateUsername("lz.zb_5o.0").ok).toBe(false);
  });
});

describe("ageFromBirthday", () => {
  const today = new Date("2026-11-05T12:00:00");

  it("counts a birthday that already happened", () => {
    expect(ageFromBirthday("2000-01-01", today)).toBe(26);
  });

  it("does not count a birthday later this year", () => {
    expect(ageFromBirthday("2000-12-31", today)).toBe(25);
  });

  it("handles the exact 13th birthday", () => {
    expect(ageFromBirthday("2013-11-05", today)).toBe(13);
    expect(ageFromBirthday("2013-11-06", today)).toBe(12);
  });
});

describe("validateBirthday", () => {
  const today = new Date("2026-11-05T12:00:00");

  it("requires a date", () => {
    expect(validateBirthday("", today)).toBeTruthy();
  });

  it("rejects under-13", () => {
    expect(validateBirthday("2015-01-01", today)).toMatch(/at least 13/);
  });

  it("rejects future dates", () => {
    expect(validateBirthday("2027-01-01", today)).toMatch(/future/);
  });

  it("accepts 13+", () => {
    expect(validateBirthday("2000-01-01", today)).toBeNull();
  });
});

describe("profileNeedsOnboarding", () => {
  it("is true for legacy profiles with null username/birthday", () => {
    expect(
      profileNeedsOnboarding({ username: null, birthday: null, onboarding_complete: false }),
    ).toBe(true);
  });

  it("is false once complete", () => {
    expect(
      profileNeedsOnboarding({
        username: "drew",
        birthday: "2000-01-01",
        onboarding_complete: true,
      }),
    ).toBe(false);
  });
});
