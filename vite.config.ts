// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { loadEnv } from "vite";

/**
 * A production build with no Supabase publishable key silently ships the
 * offline mock client: every sign-in fails with a generic error and the feed
 * renders empty. Warn loudly at build time so the cause is obvious from the
 * build log instead of from a bug report.
 *
 * The URL is no longer required: `src/integrations/supabase/project.ts` derives
 * the public project URL when only the key is present (that exact mismatch is
 * what broke coolerup.lovable.app).
 */
function warnOnMissingSupabaseEnv() {
  return {
    name: "coolerup:supabase-env-guard",
    apply: "build" as const,
    configResolved(config: { mode: string; root: string }) {
      // Values can come from the shell or from a .env file, so read both.
      const fileEnv = loadEnv(config.mode, config.root, "");
      const value = (name: string) => process.env[name] || fileEnv[name];
      if (value("VITE_SUPABASE_PUBLISHABLE_KEY")) return;
      console.warn(
        "\n[build] WARNING: VITE_SUPABASE_PUBLISHABLE_KEY is not set.\n" +
          "[build] This bundle will fall back to the offline mock client: sign-in\n" +
          "[build] and all content will be disabled in the deployed app.\n",
      );
    },
  };
}

/**
 * Every build gets a fresh id, stamped into both the client and server bundles.
 *
 * The client keeps the id it booted with; the server reports the id of the
 * build it is currently serving. When the two disagree a newer build has been
 * published, and the old client shuts itself down (see src/lib/appBuild.ts).
 * Without this, people keep running yesterday's JavaScript against today's
 * database and every deploy turns into a bug report.
 */
const BUILD_ID =
  process.env["BUILD_ID"] ||
  process.env["GITHUB_SHA"]?.slice(0, 12) ||
  `${Date.now().toString(36)}`;

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [warnOnMissingSupabaseEnv()],
    define: {
      __APP_BUILD__: JSON.stringify(BUILD_ID),
    },
    build: {
      // Broad support for older phones while keeping modern output small.
      target: "es2020",
      cssCodeSplit: true,
    },
  },
});
