// Client-side user preferences, persisted in localStorage and applied app-wide.
export const prefKey = (k: string) => `settings:${k}`;

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
};

export const readBool = (k: string, d = false) => readPref(k, String(d)) === "true";

type ThemePalette = {
  bg: string;
  fg: string;
  card: string;
  muted: string;
  mutedFg: string;
  border: string;
  primary: string;
  primaryFg: string;
  accent: string;
  accentFg: string;
  ring: string;
};

const THEMES: Record<string, ThemePalette> = {
  light: { bg: "#ffffff", fg: "#111111", card: "#ffffff", muted: "#f1f1f3", mutedFg: "#6b7280", border: "#e4e4e7", primary: "#111111", primaryFg: "#ffffff", accent: "#f1f1f3", accentFg: "#111111", ring: "#a1a1aa" },
  dark: { bg: "#000000", fg: "#fafafa", card: "#151515", muted: "#262626", mutedFg: "#a1a1aa", border: "#2e2e2e", primary: "#fafafa", primaryFg: "#111111", accent: "#262626", accentFg: "#fafafa", ring: "#71717a" },
  blue: { bg: "#2563EB", fg: "#ffffff", card: "#1d4fc4", muted: "#1e40af", mutedFg: "#dbeafe", border: "#3b82f6", primary: "#ffffff", primaryFg: "#1d4fc4", accent: "#1e40af", accentFg: "#ffffff", ring: "#93c5fd" },
  purple: { bg: "#9333ea", fg: "#ffffff", card: "#7e22ce", muted: "#6b21a8", mutedFg: "#f3e8ff", border: "#a855f7", primary: "#ffffff", primaryFg: "#7e22ce", accent: "#6b21a8", accentFg: "#ffffff", ring: "#d8b4fe" },
  pink: { bg: "#ec4899", fg: "#ffffff", card: "#db2777", muted: "#be185d", mutedFg: "#fce7f3", border: "#f472b6", primary: "#ffffff", primaryFg: "#be185d", accent: "#9d174d", accentFg: "#ffffff", ring: "#f9a8d4" },
  green: { bg: "#16a34a", fg: "#ffffff", card: "#15803d", muted: "#166534", mutedFg: "#dcfce7", border: "#22c55e", primary: "#ffffff", primaryFg: "#166534", accent: "#14532d", accentFg: "#ffffff", ring: "#86efac" },
  red: { bg: "#dc2626", fg: "#ffffff", card: "#b91c1c", muted: "#991b1b", mutedFg: "#fee2e2", border: "#ef4444", primary: "#ffffff", primaryFg: "#991b1b", accent: "#7f1d1d", accentFg: "#ffffff", ring: "#fca5a5" },
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
];

export function applyTheme(theme: string) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  let id = theme;
  if (id === "system") {
    id = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  const t = THEMES[id] ?? THEMES["dark"]!;
  const set: Record<string, string> = {
    "--background": t.bg,
    "--foreground": t.fg,
    "--card": t.card,
    "--card-foreground": t.fg,
    "--popover": t.card,
    "--popover-foreground": t.fg,
    "--muted": t.muted,
    "--muted-foreground": t.mutedFg,
    "--border": t.border,
    "--input": t.border,
    "--primary": t.primary,
    "--primary-foreground": t.primaryFg,
    "--secondary": t.accent,
    "--secondary-foreground": t.accentFg,
    "--accent": t.accent,
    "--accent-foreground": t.accentFg,
    "--ring": t.ring,
  };
  THEME_VARS.forEach((v) => root.style.setProperty(v, set[v] ?? ""));
  root.style.backgroundColor = t.bg;
  root.style.colorScheme = id === "light" ? "light" : "dark";
  if (document.body) document.body.style.backgroundColor = t.bg;
}

const LANG_CODES: Record<string, string> = { English: "en", Español: "es", Français: "fr", Deutsch: "de", Português: "pt" };

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
