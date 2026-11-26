// Client-side user preferences, persisted in localStorage and applied app-wide.
export const prefKey = (k: string) => `settings:${k}`;

/** Preference key for Low Data Mode in Settings. */
export const LOW_DATA_MODE_PREF = "low-data-mode";

/**
 * localStorage is synchronous and reading it during render is a measurable cost
 * on low-end phones. Cache values in memory; writes and cross-tab changes clear it.
 */
const prefCache = new Map<string, string | null>();

const invalidatePrefs = () => prefCache.clear();
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (!e.key || e.key.startsWith("settings:")) invalidatePrefs();
  });
}

export const readPref = (k: string, d = ""): string => {
  const cached = prefCache.get(k);
  if (cached !== undefined) return cached ?? d;
  try {
    const value = localStorage.getItem(prefKey(k));
    prefCache.set(k, value);
    return value ?? d;
  } catch {
    prefCache.set(k, null);
    return d;
  }
};

export const writePref = (k: string, v: string) => {
  prefCache.set(k, v);
  try {
    localStorage.setItem(prefKey(k), v);
  } catch {
    /* ignore */
  }
  applyPrefs();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("loop-prefs-changed", { detail: { key: k, value: v } }));
  }
};

export const readBool = (k: string, d = false) => readPref(k, String(d)) === "true";

type ThemePalette = {
  bg: string;
};

const THEMES: Record<string, ThemePalette> = {
  dark: { bg: "#000000" },
  black: { bg: "#000000" },
  light: { bg: "#27272a" },
  white: { bg: "#27272a" },
  blue: { bg: "#2563EB" },
  red: { bg: "#DC2626" },
  pink: { bg: "#EC4899" },
  green: { bg: "#16A34A" },
  purple: { bg: "#9333EA" },
  orange: { bg: "#EA580C" },
  christmas: { bg: "#16A34A" },
};

const THEME_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--muted",
  "--muted-foreground",
  "--border",
  "--input",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--ring",
  "--sidebar",
  "--sidebar-foreground",
];

export function isSupportedTheme(theme: string): boolean {
  return theme === "system" || theme in THEMES;
}

export function getThemeBackground(theme: string): string {
  const id = theme === "system" ? "dark" : theme.toLowerCase();
  return (THEMES[id] ?? THEMES["dark"]!).bg;
}

export function applyTheme(theme: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const bg = getThemeBackground(theme);
  const set: Record<string, string> = {
    "--background": bg,
    "--foreground": "#ffffff",
    "--card": "rgba(255, 255, 255, 0.09)",
    "--card-foreground": "#ffffff",
    "--popover": "#18181b",
    "--popover-foreground": "#ffffff",
    "--muted": "rgba(255, 255, 255, 0.14)",
    "--muted-foreground": "rgba(255, 255, 255, 0.8)",
    "--border": "rgba(255, 255, 255, 0.22)",
    "--input": "rgba(255, 255, 255, 0.25)",
    "--primary": "#ffffff",
    "--primary-foreground": "#000000",
    "--secondary": "rgba(255, 255, 255, 0.14)",
    "--secondary-foreground": "#ffffff",
    "--accent": "rgba(255, 255, 255, 0.14)",
    "--accent-foreground": "#ffffff",
    "--ring": "#ffffff",
    "--sidebar": bg,
    "--sidebar-foreground": "#ffffff",
  };
  THEME_VARS.forEach((v) => root.style.setProperty(v, set[v] ?? ""));
  root.style.backgroundColor = bg;
  root.style.colorScheme = "dark";
  if (document.body) document.body.style.backgroundColor = bg;
}

const LANG_CODES: Record<string, string> = {
  English: "en",
  Español: "es",
  Français: "fr",
  Deutsch: "de",
  Português: "pt",
};

export function applyPrefs() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  applyTheme(readPref("theme", "dark"));
  root.classList.toggle("reduce-motion", readBool("reduce-motion"));
  root.style.fontSize = readBool("large-text") ? "118%" : "";
  root.lang = LANG_CODES[readPref("language", "English")] ?? "en";
  let style = document.getElementById("prefs-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "prefs-style";
    style.textContent =
      ".reduce-motion *,.reduce-motion *::before,.reduce-motion *::after{animation-duration:0.001ms!important;animation-iteration-count:1!important;transition-duration:0.001ms!important;scroll-behavior:auto!important}";
    document.head.appendChild(style);
  }
}

/** Short vibration when the user has haptic feedback enabled. */
export function haptic() {
  try {
    if (readBool("haptics", true)) navigator.vibrate?.(10);
  } catch {
    /* ignore */
  }
}

export const getKeywords = (): string[] =>
  readPref("keywords", "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** True when a caption matches one of the user's hidden keywords. */
export const matchesKeyword = (text: string | null | undefined) => {
  const t = (text ?? "").toLowerCase();
  return getKeywords().some((k) => t.includes(k));
};

/** All settings as a plain object, for data export. */
export function allPrefs(): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("settings:")) out[k.slice(9)] = localStorage.getItem(k) ?? "";
    }
  } catch {
    /* ignore */
  }
  return out;
}
