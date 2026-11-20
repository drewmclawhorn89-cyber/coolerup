import { createFileRoute } from "@tanstack/react-router";
import { buildTwitchAuthorizeUrl, getTwitchRedirectUri } from "@/lib/twitch.server";

export const Route = createFileRoute("/api/twitch/auth/url")({
  server: {
    handlers: {
      GET: ({ request }) => {
        const result = buildTwitchAuthorizeUrl(request);
        if (!result) {
          // Optional feature: not an error. Watching streams never needs OAuth.
          return Response.json(
            {
              configured: false,
              redirectUri: getTwitchRedirectUri(request),
              error: "Twitch sign-in isn't set up on this server. Watching streams still works.",
            },
            { headers: { "cache-control": "no-store" } },
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
