import { createFileRoute } from "@tanstack/react-router";
import { clearTwitchSessionCookie, getTwitchSession } from "@/lib/twitch.server";

export const Route = createFileRoute("/api/twitch/me")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const session = getTwitchSession(request);
        return Response.json(
          { user: session?.user ?? null },
          { headers: { "cache-control": "no-store" } },
        );
      },
      DELETE: () => {
        return Response.json(
          { ok: true },
          {
            headers: {
              "cache-control": "no-store",
              "set-cookie": clearTwitchSessionCookie(),
            },
          },
        );
      },
    },
  },
});
