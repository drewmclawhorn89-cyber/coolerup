import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin_/subscriptions")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
});
