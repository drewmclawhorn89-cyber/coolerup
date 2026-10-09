import { createFileRoute, Link } from "@tanstack/react-router";
export const Route = createFileRoute("/u/$username")({
  component: Profile,
});
function Profile() {
  const { username } = Route.useParams();
  return <div className="p-8">Profile works: @{username} <Link to="/" className="underline">Home</Link></div>;
}
