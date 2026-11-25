import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/paywall")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
});
