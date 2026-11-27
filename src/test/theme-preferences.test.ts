import { afterEach, describe, expect, it } from "vitest";
import { applyTheme } from "../lib/prefs";

afterEach(() => { document.documentElement.removeAttribute("data-app-theme"); });

describe("theme preference boundaries", () => {
  for (const theme of ["blue", "red", "pink", "green", "purple", "christmas"]) {
    it(`${theme} cannot override shared surfaces or buttons`, () => {
      const root = document.documentElement;
      root.style.setProperty("--background", "red");
      root.style.setProperty("--primary", "blue");
      document.body.style.background = "pink";
      applyTheme(theme);
      expect(root.dataset["appTheme"]).toBe(theme);
      expect(root.style.getPropertyValue("--background")).toBe("");
      expect(root.style.getPropertyValue("--primary")).toBe("");
      expect(document.body.style.background).toBe("");
      expect(root.style.colorScheme).toBe("dark");
    });
  }
});