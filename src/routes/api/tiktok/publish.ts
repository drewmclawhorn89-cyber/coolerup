import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { callerFromRequest, jsonError, jsonOk } from "@/lib/tiktokLinkAuth.server";
import { freshAccessToken, publishVideo, tiktokCaption } from "@/lib/tiktokLink.server";
import { withTikTokSchema } from "@/lib/tiktokDatabase";

/**
 * Posts one of the caller's Coolerup videos to their linked TikTok account.
 *
 * Called right after a successful upload when "Also post to TikTok" is on. The
 * publish is logged to `tiktok_publishes` either way, so a failure is visible in
 * Settings instead of vanishing into the console.
 */
export const Route = createFileRoute("/api/tiktok/publish")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await callerFromRequest(request);
        if (!caller) return jsonError("Sign in to post to TikTok.", 401);

        let body: { videoId?: string; caption?: string; privacyLevel?: string };
        try {
          body = (await request.json()) as typeof body;
        } catch {
          return jsonError("Invalid request body.");
        }

        const videoId = body.videoId?.trim();
        if (!videoId) return jsonError("A videoId is required.");

        const auth = await freshAccessToken(caller.userId);
        if (!auth) {
          return jsonError(
            "Your TikTok account isn't linked, or TikTok revoked access. Link it again in Settings.",
            409,
          );
        }

        // Read the row through the service role, but only if this user owns it.
        const { data: video, error: readError } = await supabaseAdmin
          .from("videos")
          .select("id, user_id, caption, video_url")
          .eq("id", videoId)
          .eq("user_id", caller.userId)
          .maybeSingle();

        if (readError || !video) return jsonError("That video isn't yours.", 403);

        const caption = (body.caption ?? video.caption ?? "").toString();
        const result = await publishVideo({
          accessToken: auth.token,
          videoUrl: video.video_url,
          caption,
          privacyLevel: body.privacyLevel,
        });

        await withTikTokSchema(supabaseAdmin).from("tiktok_publishes").insert({
          user_id: caller.userId,
          video_id: video.id,
          tiktok_publish_id: result.publishId ?? null,
          status: result.ok ? (result.mode === "inbox" ? "inbox" : "posted") : "failed",
          mode: result.mode,
          caption: tiktokCaption(caption),
          error: result.error ?? null,
        });

        if (!result.ok) return jsonError(result.error ?? "TikTok rejected the post.", 502);

        return jsonOk({
          ok: true,
          mode: result.mode,
          publishId: result.publishId ?? null,
          // The inbox path lands in the user's TikTok drafts, not the public feed.
          message:
            result.mode === "inbox"
              ? "Sent to your TikTok drafts. Open TikTok to finish posting."
              : "Posted to TikTok.",
        });
      },
    },
  },
});
