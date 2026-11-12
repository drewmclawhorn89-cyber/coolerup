import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for everything under /browser.
 *
 * `browser.tsx` is the parent route for `browser.index.tsx` (/browser),
 * `browser.history.tsx` (/browser/history) and `browser.bookmarks.tsx`
 * (/browser/bookmarks), so it must render an <Outlet />.
 */
export const Route = createFileRoute("/browser")({
  component: BrowserLayout,
});

function BrowserLayout() {
  return <Outlet />;
}
