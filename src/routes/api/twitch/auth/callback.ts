import { createFileRoute } from "@tanstack/react-router";
import {
  consumeOAuthState,
  createTwitchSessionCookie,
  exchangeTwitchCode,
  getTwitchRedirectUri,
} from "@/lib/twitch.server";

function htmlResponse(html: string, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(html, { status, headers });
}

export const Route = createFileRoute("/api/twitch/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const errorParam = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");
        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");

        if (errorParam || !code || !consumeOAuthState(state)) {
          const message = JSON.stringify(
            errorDesc || errorParam || "Twitch sign-in was canceled or expired.",
          );
          return htmlResponse(
            `<!doctype html>
<html>
  <body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
    <div>
      <p style="font-size:15px;font-weight:700;">Twitch sign-in did not complete</p>
      <p style="font-size:13px;color:#a1a1aa;">You can close this window and try again.</p>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: "OAUTH_AUTH_ERROR", provider: "twitch", error: ${message} }, "*");
        window.close();
      }
    </script>
  </body>
</html>`,
            400,
          );
        }

        const redirectUri = getTwitchRedirectUri(request);
        const session = await exchangeTwitchCode(code, redirectUri);
        if (!session) {
          return htmlResponse(
            `<!doctype html>
<html>
  <body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
    <p>Couldn't verify your Twitch login. Please close this window and try again.</p>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: "OAUTH_AUTH_ERROR", provider: "twitch", error: "Failed to exchange Twitch authorization code." }, "*");
        window.close();
      }
    </script>
  </body>
</html>`,
            502,
          );
        }

        const safeUser = JSON.stringify(session.user);
        return htmlResponse(
          `<!doctype html>
<html>
  <body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
    <div>
      <p style="font-size:15px;font-weight:700;">Twitch connected</p>
      <p style="font-size:13px;color:#a1a1aa;">Returning to Coolerup...</p>
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage({ type: "OAUTH_AUTH_SUCCESS", provider: "twitch", user: ${safeUser} }, "*");
        window.close();
      } else {
        window.location.href = "/";
      }
    </script>
  </body>
</html>`,
          200,
          { "set-cookie": createTwitchSessionCookie(session) },
        );
      },
    },
  },
});
