import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { applyTheme } from "@/lib/prefs";
import { buttonVariants } from "@/components/ui/button";

const { updateProfileEq, updateProfile, maybeSingle, selectEq, selectProfile, updateUser } =
  vi.hoisted(() => {
    const updateProfileEq = vi.fn().mockResolvedValue({ error: null });
    const updateProfile = vi.fn().mockReturnValue({ eq: updateProfileEq });
    const maybeSingle = vi.fn().mockResolvedValue({ data: { theme: "purple" }, error: null });
    const selectEq = vi.fn().mockReturnValue({ maybeSingle });
    const selectProfile = vi.fn().mockReturnValue({ eq: selectEq });
    const updateUser = vi.fn().mockResolvedValue({ data: { user: null }, error: null });
    return { updateProfileEq, updateProfile, maybeSingle, selectEq, selectProfile, updateUser };
  });

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: vi.fn(() => ({
      update: updateProfile,
      select: selectProfile,
    })),
    auth: {
      updateUser,
      getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    },
  },
}));

import { loadAccountTheme, saveAccountTheme, THEME_CHANGED_EVENT } from "@/lib/themeAccount";

const root = resolve(__dirname, "../..");
const read = (rel: string) => readFileSync(resolve(root, rel), "utf8");

describe("PWA standalone layout, theme-only background & zero tap-flash buttons", () => {
  afterEach(() => {
    vi.clearAllMocks();
    applyTheme("dark");
  });

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

  it("configures standalone iOS and viewport-fit=cover meta tags and mounts ThemeSync in __root.tsx", () => {
    const rootTsx = read("src/routes/__root.tsx");
    expect(rootTsx).toContain('content: "width=device-width, initial-scale=1, viewport-fit=cover"');
    expect(rootTsx).toContain('{ name: "theme-color", content: "#000000" }');
    expect(rootTsx).toContain('{ name: "apple-mobile-web-app-capable", content: "yes" }');
    expect(rootTsx).toContain(
      '{ name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" }',
    );
    expect(rootTsx).toContain("<ThemeSync />");
    expect(rootTsx).toContain('<body className="bg-background text-foreground">');
  });

  it("removes iOS tap highlight, binds html/body/#root to var(--background), and keeps create-pink static", () => {
    const css = read("src/styles.css");
    expect(css).toMatch(
      /\*\s*\{[\s\S]*-webkit-tap-highlight-color:\s*transparent\s*!important;[\s\S]*-webkit-touch-callout:\s*none;/,
    );
    expect(css).toMatch(
      /html,\s*body,\s*#root\s*\{[\s\S]*background-color:\s*var\(--background\)\s*!important;[\s\S]*min-height:\s*100dvh;/,
    );
    expect(css).toMatch(
      /@media\s*\(display-mode:\s*standalone\)\s*\{[\s\S]*html,\s*body,\s*#root\s*\{[\s\S]*background-color:\s*var\(--background\)\s*!important;/,
    );
    expect(css).toContain("a:visited");
    const createPinkBlock = css.slice(css.indexOf("@utility create-pink"));
    const endOfCreatePink = createPinkBlock.indexOf("}");
    expect(createPinkBlock.slice(0, endOfCreatePink)).not.toContain("&:hover");
    expect(createPinkBlock.slice(0, endOfCreatePink)).not.toContain("&:active");
  });

  it("removes hover/active/focus color flashes from all UI Button variants and keeps Switch/Slider colors fixed", () => {
    const variants = ["default", "destructive", "outline", "secondary", "ghost", "link"] as const;
    for (const variant of variants) {
      const classes = buttonVariants({ variant });
      expect(classes).not.toMatch(/hover:(bg|text|border)-/);
      expect(classes).not.toMatch(/active:(bg|text|border)-/);
      expect(classes).not.toContain("focus-visible:ring-");
    }

    const switchTsx = read("src/components/ui/switch.tsx");
    expect(switchTsx).toContain("data-[state=checked]:bg-white");
    expect(switchTsx).not.toContain("bg-primary");

    const sliderTsx = read("src/components/ui/slider.tsx");
    expect(sliderTsx).toContain("bg-white");
    expect(sliderTsx).not.toContain("bg-primary");
    expect(sliderTsx).not.toContain("border-primary");
  });

  it("changes ONLY --background / root / body across themes while keeping foreground, primary, and accents fixed", () => {
    const expectedBackgrounds: Record<string, [string, string]> = {
      dark: ["#000000", "rgb(0, 0, 0)"],
      blue: ["#2563EB", "rgb(37, 99, 235)"],
      red: ["#DC2626", "rgb(220, 38, 38)"],
      pink: ["#EC4899", "rgb(236, 72, 153)"],
      green: ["#16A34A", "rgb(22, 163, 74)"],
      purple: ["#9333EA", "rgb(147, 51, 234)"],
      orange: ["#EA580C", "rgb(234, 88, 12)"],
    };

    for (const [theme, [hex, rgb]] of Object.entries(expectedBackgrounds)) {
      applyTheme(theme);
      const docEl = document.documentElement;
      expect(docEl.style.getPropertyValue("--background")).toBe(hex);
      expect(docEl.style.backgroundColor).toBe(rgb);
      expect(document.body.style.backgroundColor).toBe(rgb);
      expect(docEl.style.getPropertyValue("--foreground")).toBe("#ffffff");
      expect(docEl.style.getPropertyValue("--primary")).toBe("#ffffff");
      expect(docEl.style.getPropertyValue("--primary-foreground")).toBe("#000000");
    }
  });

  it("persists and loads the account theme by user_id across devices without page reload", async () => {
    const events: string[] = [];
    const listener = (e: Event) => {
      const next = (e as CustomEvent<{ theme?: string }>).detail?.theme;
      if (next) events.push(next);
    };
    window.addEventListener(THEME_CHANGED_EVENT, listener);

    const saved = await saveAccountTheme("user-123", "blue");
    expect(saved).toEqual({ ok: true, theme: "blue" });
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#2563EB");
    expect(updateProfile).toHaveBeenCalledWith({ theme: "blue" });
    expect(updateProfileEq).toHaveBeenCalledWith("id", "user-123");
    expect(updateUser).toHaveBeenCalledWith({ data: { theme: "blue" } });
    expect(events).toContain("blue");

    const loaded = await loadAccountTheme("user-123");
    expect(loaded).toBe("purple");
    expect(document.documentElement.style.getPropertyValue("--background")).toBe("#9333EA");
    expect(events).toContain("purple");

    window.removeEventListener(THEME_CHANGED_EVENT, listener);
  });

  it("renders edge-to-edge themed bg-background on Index, Settings, Profile, Messages, and fixed white/black Follow buttons", () => {
    const indexTsx = read("src/routes/index.tsx");
    expect(indexTsx).toContain('className="flex h-[100dvh] w-full overflow-hidden bg-background"');
    expect(indexTsx).not.toContain("max-w-[430px]");
    expect(indexTsx).toContain('"border-white font-bold text-white"');
    expect(indexTsx).toContain("overlayBottomNav");
    expect(indexTsx).toContain("bg-background");
    expect(indexTsx).not.toContain("hover:bg-white/30");
    expect(indexTsx).not.toContain("hover:brightness-95");

    const settingsTsx = read("src/routes/settings.tsx");
    expect(settingsTsx).toContain("saveAccountTheme");
    expect(settingsTsx).toContain("bg-background");
    expect(settingsTsx).not.toMatch(/bg-black\s+(p-|px-|pb-|text-white)/);
    expect(settingsTsx).not.toContain('"var(--primary)"');

    const messagesTsx = read("src/routes/messages.tsx");
    expect(messagesTsx).toContain("bg-background");

    const videoCardTsx = read("src/components/VideoCard.tsx");
    expect(videoCardTsx).toContain(
      "feed-card relative h-full w-full snap-start snap-always bg-transparent",
    );
    expect(videoCardTsx).toContain(
      'className="-mt-2.5 flex h-5 w-5 items-center justify-center rounded-full bg-white text-[12px] font-bold leading-none text-black"',
    );

    const profileTsx = read("src/routes/u.$username.tsx");
    expect(profileTsx).toContain('className="min-w-36 rounded-full bg-white font-bold text-black"');

    const searchResultsTsx = read("src/components/SearchResults.tsx");
    expect(searchResultsTsx).toContain(
      'className="shrink-0 rounded-full bg-white px-4 py-1.5 text-[13px] font-bold text-black"',
    );
  });
});
