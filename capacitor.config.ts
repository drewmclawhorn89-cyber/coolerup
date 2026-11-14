import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Coolerup Android shell.
 *
 * The browser inside Coolerup is **not** a home-grown engine. On Android it is
 * `android.webkit.WebView`, which is Chromium — the same engine that powers
 * Chrome and Edge. Capacitor hosts that WebView for us, so video, JavaScript
 * and modern CSS all work exactly as they do in Chrome.
 *
 * Branding stays Coolerup:
 *   • `appendUserAgent` adds `CoolerupBrowser/1.0` to the Chromium UA, so sites
 *     see "Coolerup Browser" while still receiving the Chrome feature set.
 *     (MainActivity.java applies the same value directly as a belt-and-braces
 *     override for the WebView used by the in-app browser.)
 *   • `appName` is "Coolerup", never "Chrome".
 *
 * The web app is a TanStack Start SSR app: the feed and auth talk to Supabase
 * straight from the client, but push, payments and gift cards go through
 * server functions. Shipping a purely static bundle would break those, so the
 * WebView loads the live app (server.url) and the built assets in `webDir` act
 * as the offline fallback. This keeps every feature working — For You,
 * Following, Marketplace, Groups, LIVE, Inbox — with no native rewrite.
 */
const config: CapacitorConfig = {
  appId: "com.coolerup.app",
  appName: "Coolerup",
  webDir: ".output/public",
  server: {
    url: "https://coolerup.lovable.app",
    androidScheme: "https",
    allowNavigation: ["coolerup.lovable.app", "*.lovable.app", "*.supabase.co"],
  },
  android: {
    // Chromium WebView settings. `appendUserAgent` is the supported way to
    // brand the UA without breaking Chrome feature detection.
    appendUserAgent: "CoolerupBrowser/1.0",
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    // Keep the WebView on the modern Chromium renderer (no legacy bridge).
    useLegacyBridge: false,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1200,
      backgroundColor: "#000000",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
