import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * `/watch` on its own has no video to play. Send people back to the browse
 * page instead of showing a 404 — this happens when someone trims the URL by
 * hand or a stale link drops the id.
 */
export const Route = createFileRoute("/watch/")({
  beforeLoad: () => {
    throw redirect({ to: "/videos" });
  },
});
