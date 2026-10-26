// Client-side user preferences, persisted in localStorage and applied app-wide.
export const prefKey = (k: string) => `settings:${k}`;

export const readPref = (k: string, d = ""): string => {
  try {
    return localStorage.getItem(prefKey(k)) ?? d;
  } catch {
    return d;
  }
};

export const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(prefKey(k), v);
  } catch {
    /* ignore */
  }
  applyPrefs();
};

export const readBool = (k: string, d = false) => readPref(k, String(d)) === "true";

const THEMES: Record<string, { bg: string; fg: string; card: string; muted: string; mutedFg: string; border: string }> = {
  light: { bg: "#ffffff", fg: "#111111", card: "#ffffff", muted: "#f1f1f3", mutedFg: "#6b7280", border: "#e4e4e7" },
  dark: { bg: "#000000", fg: "#fafafa", card: "#151515", muted: "#262626", mutedFg: "#a1a1aa", border: "#2e2e2e" },
  blue: { bg: "#2563EB", fg: "#ffffff", card: "#1d4fc4", muted: "#1e40af", mutedFg: "#dbeafe", border: "#3b82f6" },
  purple: { bg: "#9333ea", fg: "#ffffff", card: "#7e22ce", muted: "#6b21a8", mutedFg: "#f3e8ff", border: "#a855f7" },
  pink: { bg: "#ec4899", fg: "#ffffff", card: "#db2777", muted: "#be185d", mutedFg: "#fce7f3", border: "#f472b6" },
  green: { bg: "#16a34a", fg: "#ffffff", card: "#15803d", muted: "#166534", mutedFg: "#dcfce7", border: "#22c55e" },
};

const THEME_VARS = ["--background", "--foreground", "--card", "--card-foreground", "--popover", "--popover-foreground", "--muted", "--muted-foreground", "--border", "--input"];

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
