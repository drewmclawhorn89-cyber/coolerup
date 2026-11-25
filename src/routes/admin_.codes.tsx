import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/admin_/codes")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
});
