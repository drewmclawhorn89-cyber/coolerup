import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GroupsPage, type FeedTab } from "@/components/GroupsPage";

export const Route = createFileRoute("/groups")({
  head: () => ({
    meta: [
      { title: "Groups — Coolerup" },
      { name: "description", content: "Find your people. Join or create a group on Coolerup." },
      { property: "og:title", content: "Groups — Coolerup" },
      {
        property: "og:description",
        content: "Find your people. Join or create a group on Coolerup.",
      },
    ],
  }),
  component: GroupsRoute,
});

function GroupsRoute() {
  const navigate = useNavigate();
  return (
    <GroupsPage
      feedTab="groups"
      onPick={(tab: FeedTab) => {
        if (tab === "groups") return;
        void navigate({ to: "/", search: { feed: tab } as any });
      }}
    />
  );
}
