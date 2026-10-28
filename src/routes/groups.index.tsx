import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { GroupsPanel } from "@/components/GroupsPanel";

export const Route = createFileRoute("/groups/")({
  head: () => ({
    meta: [
      { title: "Groups — Coolerup" },
      { name: "description", content: "Create and join groups on Coolerup." },
    ],
  }),
  component: GroupsIndex,
});

function GroupsIndex() {
  return (
    <div className="min-h-dvh bg-black text-white">
      <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-white/10 bg-black/95 px-3 py-2 backdrop-blur">
        <Link
          to="/"
          aria-label="Back to feed"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-[#222] text-white"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-[18px] font-bold">
          coolerup<span className="text-primary">.</span> groups
        </h1>
      </div>
      <GroupsPanel />
    </div>
  );
}
