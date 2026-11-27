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

export type ThemePalette = {
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

const BLACK_BASE = {
  bg: "#000000",
  fg: "#ffffff",
  card: "#141414",
  muted: "#262626",
  mutedFg: "#a1a1aa",
  border: "rgba(255, 255, 255, 0.14)",
  accent: "#262626",
  accentFg: "#ffffff",
} as const;

export const THEMES: Record<string, ThemePalette> = {
  dark: {
    ...BLACK_BASE,
    primary: "#fe2c55",
    primaryFg: "#ffffff",
    ring: "#fe2c55",
  },
  black: {
    ...BLACK_BASE,
    primary: "#fe2c55",
    primaryFg: "#ffffff",
    ring: "#fe2c55",
  },
  light: {
    ...BLACK_BASE,
    primary: "#ffffff",
    primaryFg: "#000000",
    ring: "#ffffff",
  },
  white: {
    ...BLACK_BASE,
    primary: "#ffffff",
    primaryFg: "#000000",
    ring: "#ffffff",
  },
  blue: {
    ...BLACK_BASE,
    primary: "#2563eb",
    primaryFg: "#ffffff",
    ring: "#3b82f6",
  },
  purple: {
    ...BLACK_BASE,
    primary: "#9333ea",
    primaryFg: "#ffffff",
    ring: "#a855f7",
  },
  pink: {
    ...BLACK_BASE,
    primary: "#ec4899",
    primaryFg: "#ffffff",
    ring: "#f472b6",
  },
  green: {
    ...BLACK_BASE,
    primary: "#16a34a",
    primaryFg: "#ffffff",
    ring: "#22c55e",
  },
  red: {
    ...BLACK_BASE,
    primary: "#dc2626",
    primaryFg: "#ffffff",
    ring: "#ef4444",
  },
  orange: {
    ...BLACK_BASE,
    primary: "#ea580c",
    primaryFg: "#ffffff",
    ring: "#f97316",
  },
  christmas: {
    ...BLACK_BASE,
    primary: "#16a34a",
    primaryFg: "#ffffff",
    ring: "#dc2626",
  },
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
  let id = theme.trim().toLowerCase();
  if (id === "system") {
    id = window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  const t = THEMES[id] ?? THEMES["dark"]!;
  const set: Record<string, string> = {
    "--background": "#000000",
    "--foreground": "#ffffff",
    "--card": t.card,
    "--card-foreground": "#ffffff",
    "--popover": t.card,
    "--popover-foreground": "#ffffff",
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
  root.style.backgroundColor = "#000000";
  root.style.colorScheme = "dark";
  if (document.body) {
    document.body.style.backgroundColor = "#000000";
    document.body.style.color = "#ffffff";
  }
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta) {
    themeMeta.setAttribute("content", "#000000");
  }
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
