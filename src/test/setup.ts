import "@testing-library/jest-dom/vitest";
import { beforeEach } from "vitest";
import { clearAccountSubscriptionCache } from "@/lib/accountSubscriptions";

// Tests must not depend on whatever credentials happen to sit in the developer's
// .env: with real Supabase values present, `@supabase/auth-js` starts reading
// localStorage and talking to the network mid-test, which shows up as flaky
// failures and unhandled rejections. Blank the keys so every run uses the
// deterministic offline mock client.
for (const key of ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"]) {
  (import.meta.env as Record<string, string>)[key] = "";
}
delete process.env["SUPABASE_URL"];
delete process.env["SUPABASE_PUBLISHABLE_KEY"];

// The subscription cache is in memory now, so reset it between tests.
beforeEach(() => {
  localStorage.clear();
  clearAccountSubscriptionCache();
});

Object.defineProperty(window, "scrollTo", {
  writable: true,
  value: () => {},
});

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
