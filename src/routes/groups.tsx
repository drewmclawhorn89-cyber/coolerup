import { createFileRoute, Outlet } from "@tanstack/react-router";

/**
 * Layout for everything under /groups.
 *
 * `groups.tsx` is the parent route for `groups.index.tsx` (/groups) and
 * `groups.$groupId.tsx` (/groups/:groupId), so it must render an <Outlet />.
 */
export const Route = createFileRoute("/groups")({
  component: GroupsLayout,
});

function GroupsLayout() {
  return (
    <div className="mx-auto min-h-dvh w-full max-w-[430px] bg-black text-white">
      <Outlet />
    </div>
  );
}
