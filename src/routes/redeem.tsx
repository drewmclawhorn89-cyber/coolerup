import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/redeem")({
  beforeLoad: () => {
    throw redirect({ to: "/settings" });
  },
});
