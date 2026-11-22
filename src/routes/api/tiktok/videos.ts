import { createFileRoute } from "@tanstack/react-router";
import { callerFromRequest, jsonError, jsonOk } from "@/lib/tiktokLinkAuth.server";
import { freshAccessToken, listMyVideos } from "@/lib/tiktokLink.server";

/**
 * Lists the caller's OWN TikTok videos, for the "Import from TikTok" picker.
 *
 * The token used is the one stored for this user, so TikTok itself scopes the
 * response to their account. There is no parameter for a handle or an open_id:
 * a caller cannot ask this route for anyone else's videos.
 */
export const Route = createFileRoute("/api/tiktok/videos")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const caller = await callerFromRequest(request);
        if (!caller) return jsonError("Sign in to see your TikTok videos.", 401);

        const auth = await freshAccessToken(caller.userId);
        if (!auth) {
          return jsonError(
            "Your TikTok account isn't linked, or TikTok revoked access. Link it again in Settings.",
            409,
          );
        }

        const url = new URL(request.url);
        const cursor = Number(url.searchParams.get("cursor") ?? "0");
        try {
          const page = await listMyVideos(auth.token, Number.isFinite(cursor) ? cursor : 0);
          return jsonOk({
            username: auth.account.username,
            videos: page.videos.map((v) => ({
              id: v.id,
              title: v.title ?? "",
              description: v.video_description ?? "",
              coverUrl: v.cover_image_url ?? null,
              shareUrl: v.share_url ?? null,
              duration: v.duration ?? 0,
              createdAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
            })),
            cursor: page.cursor,
            hasMore: page.hasMore,
          });
        } catch (error) {
          return jsonError(error instanceof Error ? error.message : "TikTok video list failed.", 502);
        }
      },
    },
  },
});
