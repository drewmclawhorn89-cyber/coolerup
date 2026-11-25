import { createFileRoute, redirect } from "@tanstack/react-router";

// Keep existing links from shares, comments and reports opening the same post.
export const Route = createFileRoute("/v/$id")({
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/", search: { sharedVideo: params.id }, replace: true });
  },
});
