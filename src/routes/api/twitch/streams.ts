import { createFileRoute } from "@tanstack/react-router";
import { fetchTwitchDirectory } from "@/lib/twitch.server";

export const Route = createFileRoute("/api/twitch/streams")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const gameId = url.searchParams.get("gameId") ?? undefined;
        const query = url.searchParams.get("q") ?? undefined;
        const result = await fetchTwitchDirectory(request, { gameId, query });
        return Response.json(result, {
          headers: { "cache-control": "no-store" },
        });
      },
    },
  },
});
