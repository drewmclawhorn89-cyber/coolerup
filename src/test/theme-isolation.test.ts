import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTheme, THEMES, writePref } from "@/lib/prefs";

const rootDir = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(rootDir, p), "utf8");

const ALL_THEMES = [
  "blue",
  "red",
  "pink",
  "green",
  "purple",
  "orange",
  "dark",
  "black",
  "light",
  "white",
  "christmas",
  "system",
] as const;

describe("theme isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
  });

  it("keeps html, body, and --background pure black #000000 for EVERY theme", () => {
    for (const theme of ALL_THEMES) {
      applyTheme(theme);

      const root = document.documentElement;
      expect(root.style.getPropertyValue("--background")).toBe("#000000");
      expect(root.style.getPropertyValue("--foreground")).toBe("#ffffff");
      expect(root.style.backgroundColor).toMatch(/^(#000000|rgb\(0,\s*0,\s*0\))$/i);
      expect(document.body.style.backgroundColor).toMatch(/^(#000000|rgb\(0,\s*0,\s*0\))$/i);
      expect(root.style.colorScheme).toBe("dark");
    }
  });

  it("routes the picked theme color only to --primary / --ring and never leaks into background when switching themes", () => {
    writePref("theme", "blue");
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#2563eb");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#000000");
    expect(document.body.style.backgroundColor).toBe("rgb(0, 0, 0)");

    writePref("theme", "red");
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#dc2626");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#000000");
    expect(document.body.style.backgroundColor).toBe("rgb(0, 0, 0)");

    writePref("theme", "pink");
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe("#ec4899");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#000000");
    expect(document.body.style.backgroundColor).toBe("rgb(0, 0, 0)");
  });

  it("never defines a non-black outer bg in THEMES and never leaves buttons pure black", () => {
    for (const [id, palette] of Object.entries(THEMES)) {
      expect(palette.bg, `theme ${id} bg`).toBe("#000000");
      expect(palette.fg, `theme ${id} fg`).toBe("#ffffff");
      expect(palette.primary, `theme ${id} primary`).not.toBe("#000000");
    }
  });

  it("keeps outer app edge-to-edge on mobile with pure black safe areas and theme-colored controls", () => {
    const indexSrc = read("src/routes/index.tsx");
    const stylesSrc = read("src/styles.css");

    expect(indexSrc).not.toContain("max-w-[430px]");
    expect(indexSrc).toContain("w-screen max-w-none overflow-hidden bg-black");
    expect(indexSrc).toContain("pb-[env(safe-area-inset-bottom)]");
    expect(indexSrc).toContain("border-primary font-bold text-white");
    expect(indexSrc).not.toContain('backgroundColor: "#ec4899"');
    expect(stylesSrc).toContain("background-color: #000000 !important;");
  });
});
