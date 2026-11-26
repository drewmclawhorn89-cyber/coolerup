import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { applyTheme } from "@/lib/prefs";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("PWA standalone layout & theme configuration", () => {
  it("sets standalone display, #000000 background_color & theme_color, and portrait orientation in manifests", () => {
    for (const file of ["public/manifest.json", "public/manifest.webmanifest"]) {
      const manifest = JSON.parse(read(file)) as {
        display?: string;
        background_color?: string;
        theme_color?: string;
        orientation?: string;
      };
      expect(manifest.display).toBe("standalone");
      expect(manifest.background_color).toBe("#000000");
      expect(manifest.theme_color).toBe("#000000");
      expect(manifest.orientation).toBe("portrait");
    }
  });

  it("configures standalone iOS and viewport-fit=cover meta tags with black shell in __root.tsx", () => {
    const rootTsx = read("src/routes/__root.tsx");
    expect(rootTsx).toContain('content: "width=device-width, initial-scale=1, viewport-fit=cover"');
    expect(rootTsx).toContain('{ name: "theme-color", content: "#000000" }');
    expect(rootTsx).toContain('{ name: "apple-mobile-web-app-capable", content: "yes" }');
    expect(rootTsx).toContain(
      '{ name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" }',
    );
    expect(rootTsx).toContain('<html lang="en" style={{ backgroundColor: "#000000" }}>');
    expect(rootTsx).toContain(
      '<body className="bg-black text-white" style={{ backgroundColor: "#000000" }}>',
    );
  });

  it("enforces #000000 background in styles.css including standalone display mode", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(
      /html,\s*body,\s*#root\s*\{[\s\S]*background-color:\s*#000000\s*!important;[\s\S]*min-height:\s*100dvh;/,
    );
    expect(css).toMatch(
      /@media\s*\(display-mode:\s*standalone\)\s*\{[\s\S]*html,\s*body,\s*#root\s*\{[\s\S]*background-color:\s*#000000\s*!important;/,
    );
  });

  it("keeps html, body, and --background #000000 across every theme while updating --primary", () => {
    const expectedPrimaries: Record<string, string> = {
      blue: "#2563EB",
      purple: "#9333ea",
      pink: "#ec4899",
      green: "#16a34a",
      red: "#dc2626",
      dark: "#fafafa",
      light: "#fafafa",
    };

    for (const [theme, expectedPrimary] of Object.entries(expectedPrimaries)) {
      applyTheme(theme);
      const docEl = document.documentElement;
      expect(docEl.style.getPropertyValue("--background")).toBe("#000000");
      expect(docEl.style.backgroundColor).toBe("rgb(0, 0, 0)");
      expect(document.body.style.backgroundColor).toBe("rgb(0, 0, 0)");
      expect(docEl.style.getPropertyValue("--primary")).toBe(expectedPrimary);
    }
  });

  it("renders edge-to-edge 100dvh feed with overlaid top tabs and bottom nav in index.tsx and VideoCard.tsx", () => {
    const indexTsx = read("src/routes/index.tsx");
    expect(indexTsx).toContain('className="flex h-[100dvh] w-full overflow-hidden bg-black"');
    expect(indexTsx).not.toContain("max-w-[430px]");
    expect(indexTsx).toContain('"border-primary font-bold text-white"');
    expect(indexTsx).toContain("overlayBottomNav");

    const videoCardTsx = read("src/components/VideoCard.tsx");
    expect(videoCardTsx).toContain(
      'className={`absolute inset-0 h-full w-full cursor-pointer ${full ? "object-contain" : "object-cover"}',
    );
  });
});
