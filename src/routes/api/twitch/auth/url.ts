import { createFileRoute } from "@tanstack/react-router";
import { buildTwitchAuthorizeUrl, getTwitchRedirectUri } from "@/lib/twitch.server";

export const Route = createFileRoute("/api/twitch/auth/url")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const result = buildTwitchAuthorizeUrl(request);
        if (!result) {
          return Response.json(
            {
              configured: false,
              redirectUri: getTwitchRedirectUri(request),
              error:
                "Twitch OAuth needs TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET set on the server.",
            },
            { status: 400, headers: { "cache-control": "no-store" } },
          );
        }
        return Response.json(
          {
            configured: true,
            url: result.url,
            redirectUri: result.redirectUri,
          },
          { headers: { "cache-control": "no-store" } },
        );
      },
    },
  },
});
