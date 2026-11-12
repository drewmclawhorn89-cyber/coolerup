// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

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
