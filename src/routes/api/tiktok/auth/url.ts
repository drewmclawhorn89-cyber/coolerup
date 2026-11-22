import { createFileRoute } from "@tanstack/react-router";
import { callerFromRequest, jsonError, jsonOk } from "@/lib/tiktokLinkAuth.server";
import { buildAuthorizeUrl, getTikTokRedirectUri, isTikTokConfigured } from "@/lib/tiktokLink.server";

export const Route = createFileRoute("/api/tiktok/auth/url")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await callerFromRequest(request);
        if (!caller) return jsonError("Sign in to link a TikTok account.", 401);

        if (!isTikTokConfigured()) {
          // Not an error the user can fix: the deploy is missing app credentials.
          return jsonOk({
            configured: false,
            redirectUri: getTikTokRedirectUri(request),
            error:
              "TikTok linking isn't set up on this server yet. Add TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET.",
          });
        }

        const url = buildAuthorizeUrl(request, caller.userId);
        if (!url) return jsonError("Could not build the TikTok sign-in URL.", 500);

        return jsonOk({ configured: true, url, redirectUri: getTikTokRedirectUri(request) });
      },
    },
  },
});
