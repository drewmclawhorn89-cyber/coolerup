import { createFileRoute } from "@tanstack/react-router";
import {
  exchangeCode,
  fetchUserInfo,
  getTikTokRedirectUri,
  openState,
  saveLinkedAccount,
} from "@/lib/tiktokLink.server";

/** JSON for embedding inside an inline script; escapes markup that could close the tag. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function page(input: { title: string; detail: string; script: string }): string {
  return `<!doctype html>
<html>
  <body style="background:#000;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;padding:24px;text-align:center;">
    <div>
      <p style="font-size:15px;font-weight:700;">${input.title}</p>
      <p style="font-size:13px;color:#a1a1aa;">${input.detail}</p>
    </div>
    <script>${input.script}</script>
  </body>
</html>`;
}

export const Route = createFileRoute("/api/tiktok/auth/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const errorParam = url.searchParams.get("error");
        const errorDesc = url.searchParams.get("error_description");
        const code = url.searchParams.get("code");
        const state = openState(url.searchParams.get("state"));

        if (errorParam || !code || !state) {
          const message = scriptJson(
            String(errorDesc || errorParam || "TikTok sign-in was canceled or expired.").slice(0, 300),
          );
          return htmlResponse(
            page({
              title: "TikTok sign-in did not complete",
              detail: "You can close this window and try again.",
              script: `if (window.opener) { window.opener.postMessage({ type: "TIKTOK_LINK_ERROR", error: ${message} }, "*"); window.close(); }`,
            }),
            400,
          );
        }

        const tokens = await exchangeCode(code, getTikTokRedirectUri(request));
        if (!tokens) {
          return htmlResponse(
            page({
              title: "Couldn't verify your TikTok login",
              detail: "Close this window and try again.",
              script: `if (window.opener) { window.opener.postMessage({ type: "TIKTOK_LINK_ERROR", error: "TikTok rejected the authorization code." }, "*"); window.close(); }`,
            }),
            502,
          );
        }

        const info = await fetchUserInfo(tokens.access_token);
        if (!info) {
          return htmlResponse(
            page({
              title: "Couldn't read your TikTok profile",
              detail: "Check that the app has the user.info.basic scope, then try again.",
              script: `if (window.opener) { window.opener.postMessage({ type: "TIKTOK_LINK_ERROR", error: "TikTok did not return the account profile." }, "*"); window.close(); }`,
            }),
            502,
          );
        }

        await saveLinkedAccount(state.userId, tokens, info);

        const safe = scriptJson({
          username: info.username,
          displayName: info.display_name ?? null,
          avatarUrl: info.avatar_url ?? null,
          followerCount: info.follower_count ?? 0,
        });
        return htmlResponse(
          page({
            title: "TikTok connected",
            detail: "Returning to Coolerup...",
            script: `if (window.opener) { window.opener.postMessage({ type: "TIKTOK_LINK_SUCCESS", account: ${safe} }, "*"); window.close(); } else { window.location.href = "/settings"; }`,
          }),
        );
      },
    },
  },
});
