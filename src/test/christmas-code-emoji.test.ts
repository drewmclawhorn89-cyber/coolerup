import { describe, expect, it } from "vitest";
import { CHRISTMAS_CODE_HIGHLIGHTS } from "@/lib/christmas-codes";

/**
 * Regression guard for the emoji in the seasonal codes panel.
 *
 * The highlights used to be written as `"\U0001F983"`. `\U` is not a valid
 * JavaScript escape, so the string silently became the literal text
 * "U0001F983" and the panel rendered that instead of a turkey. The correct
 * form is `"\u{1F983}"`. These tests fail loudly if anyone reintroduces the
 * broken escape.
 */
describe("Christmas code highlights", () => {
  it("every highlight has an emoji that is a single printable character cluster", () => {
    for (const highlight of CHRISTMAS_CODE_HIGHLIGHTS) {
      expect(highlight.emoji.length).toBeGreaterThan(0);
      // A real emoji is non-ASCII; the broken escape produced plain ASCII.
      const hasNonAscii = [...highlight.emoji].some((ch) => (ch.codePointAt(0) ?? 0) > 0x7f);
      expect(hasNonAscii).toBe(true);
    }
  });

  it("never leaks the raw code point as text", () => {
    for (const highlight of CHRISTMAS_CODE_HIGHLIGHTS) {
      expect(highlight.emoji).not.toMatch(/^U[0-9A-Fa-f]{8}/);
      expect(highlight.emoji).not.toMatch(/\\U/);
    }
  });

  it("keeps the turkey for the Thanksgiving drop", () => {
    const thanksgiving = CHRISTMAS_CODE_HIGHLIGHTS.find((h) => h.code === "THANKSGIVING-2026");
    expect(thanksgiving?.emoji).toBe("\u{1F983}");
  });

  it("keeps the shopping bags for Black Friday, including the variation selector", () => {
    const blackFriday = CHRISTMAS_CODE_HIGHLIGHTS.find((h) => h.code === "BLACKFRIDAY-2026");
    expect(blackFriday?.emoji).toBe("\u{1F6CD}\uFE0F");
  });
});
