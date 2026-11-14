/**
 * Coolerup Browser — engine layer
 * ================================
 *
 * Coolerup Browser does **not** ship its own rendering engine. It borrows the
 * engine that is already on the device:
 *
 *   • Android  → `android.webkit.WebView`, which is Chromium (the same engine
 *                that powers Chrome and Edge). Capacitor hosts it for us.
 *   • Web      → a plain `<iframe>`, which is rendered by the user's own
 *                browser — Chrome, Edge, Brave, Safari… all Chromium/WebKit.
 *
 * That means pages load fast, JavaScript runs, and video plays exactly the way
 * it does in Chrome, while every visible label still says **Coolerup Browser**.
 * Think of it the way Edge says "Edge" but runs on Chromium underneath.
 *
 * The only thing Coolerup owns is the *chrome*: the top bar, tabs, history,
 * bookmarks and downloads. Those live in Coolerup's own storage, never in
 * Chrome's profile.
 */

/* -------------------------------------------------------------------------- */
/* Branding                                                                   */
/* -------------------------------------------------------------------------- */

/** The product name shown in every piece of UI. Never "Chrome". */
export const BROWSER_PRODUCT = "Coolerup Browser";

/** The engine that actually renders pages. */
export const BROWSER_ENGINE = "Chromium";

/** Chromium major version we advertise. Kept in step with the Android WebView. */
export const BROWSER_ENGINE_VERSION = "120";

/**
 * User-Agent sent to sites.
 *
 * It is a normal Chrome/Chromium UA with `CoolerupBrowser/1.0` added, so sites
 * see "Coolerup Browser" while still receiving the Chrome feature set. This is
 * the same trick Edge uses (`Edg/…` on top of Chrome).
 */
export const COOLERUP_USER_AGENT =
  "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) " +
  "CoolerupBrowser/1.0 Chrome/120.0.0.0 Mobile Safari/537.36";

/** Short line for the About footer, e.g. "Powered by Chromium 120". */
export const POWERED_BY = `Powered by ${BROWSER_ENGINE} ${BROWSER_ENGINE_VERSION}`;

/** The About line required by the product spec. */
export const ABOUT_LINE = `About ${BROWSER_PRODUCT} — ${POWERED_BY}`;

/* -------------------------------------------------------------------------- */
/* Which engine is hosting us?                                                */
/* -------------------------------------------------------------------------- */

export type BrowserEngineKind = "chromium-webview" | "chromium-iframe";

type CapacitorGlobal = {
  isNativePlatform?: () => boolean;
  getPlatform?: () => string;
};

const capacitor = (): CapacitorGlobal | undefined =>
  (globalThis as unknown as { Capacitor?: CapacitorGlobal }).Capacitor;

/** True when we are running inside the Coolerup Android shell. */
export function isNativeApp(): boolean {
  try {
    const cap = capacitor();
    return !!cap?.isNativePlatform?.();
  } catch {
    return false;
  }
}

/**
 * The engine backing the current surface.
 *
 * Both values are Chromium — the difference is only *who* hosts it.
 */
export function browserEngineKind(): BrowserEngineKind {
  return isNativeApp() ? "chromium-webview" : "chromium-iframe";
}

/** Human label for the engine, e.g. "Chromium (WebView)". */
export function browserEngineLabel(): string {
  return browserEngineKind() === "chromium-webview"
    ? `${BROWSER_ENGINE} (WebView)`
    : `${BROWSER_ENGINE} (iframe)`;
}

/* -------------------------------------------------------------------------- */
/* iframe engine helpers (web)                                                */
/* -------------------------------------------------------------------------- */

/**
 * Some Chromium builds refuse to frame Google's normal results page. The
 * `igu=1` parameter asks Google for the embeddable variant, so search still
 * runs inside Coolerup instead of bouncing out.
 */
export function chromeFrameUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const isGoogle = host === "google.com" || host.endsWith(".google.com");
    if (isGoogle && parsed.pathname === "/search" && !parsed.searchParams.has("igu")) {
      parsed.searchParams.set("igu", "1");
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Attributes every Coolerup iframe uses. `allow-same-origin` is required for
 * real sites (cookies, storage, logins). Downloads stay disabled on purpose:
 * Coolerup keeps its own downloads list instead of handing files to Chrome.
 */
export const CHROME_FRAME_SANDBOX = [
  "allow-scripts",
  "allow-same-origin",
  "allow-forms",
  "allow-popups",
  "allow-popups-to-escape-sandbox",
  "allow-presentation",
  "allow-modals",
].join(" ");

/** Permissions handed to the framed page (video, fullscreen, clipboard…). */
export const CHROME_FRAME_ALLOW = [
  "clipboard-write",
  "encrypted-media",
  "picture-in-picture",
  "fullscreen",
  "autoplay",
  "camera",
  "microphone",
  "geolocation",
].join("; ");

/* -------------------------------------------------------------------------- */
/* Native WebView helper (Android)                                            */
/* -------------------------------------------------------------------------- */

/**
 * The exact UA the Android shell should apply to its WebView. Exposed here so
 * the value has a single source of truth and the Java side can be kept in sync.
 */
export const NATIVE_WEBVIEW_USER_AGENT = COOLERUP_USER_AGENT;
