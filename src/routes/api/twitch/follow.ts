import { createFileRoute } from "@tanstack/react-router";
import { checkUserFollowsBroadcaster, getTwitchSession } from "@/lib/twitch.server";

export const Route = createFileRoute("/api/twitch/follow")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = getTwitchSession(request);
        if (!session) {
          return Response.json(
            { connected: false, following: false },
            { headers: { "cache-control": "no-store" } },
          );
        }
        const url = new URL(request.url);
        const broadcasterId = url.searchParams.get("broadcasterId") ?? "";
        const following = await checkUserFollowsBroadcaster(session, broadcasterId);
        return Response.json(
          { connected: true, following },
          { headers: { "cache-control": "no-store" } },
        );
      },
      POST: async ({ request }) => {
        const session = getTwitchSession(request);
        if (!session) {
          return Response.json(
            { error: "Connect your Twitch account first." },
            { status: 401, headers: { "cache-control": "no-store" } },
          );
        }
        const body = (await request.json().catch(() => null)) as {
          broadcasterLogin?: string;
          follow?: boolean;
        } | null;
        return Response.json(
          {
            connected: true,
            broadcasterLogin: body?.broadcasterLogin ?? "",
            following: Boolean(body?.follow),
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
