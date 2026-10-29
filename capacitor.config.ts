import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Coolerup Android shell.
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
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
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
