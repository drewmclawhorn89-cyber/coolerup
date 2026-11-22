import { createFileRoute } from "@tanstack/react-router";
import { callerFromRequest, jsonError, jsonOk } from "@/lib/tiktokLinkAuth.server";
import { unlinkAccount } from "@/lib/tiktokLink.server";

export const Route = createFileRoute("/api/tiktok/unlink")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const caller = await callerFromRequest(request);
        if (!caller) return jsonError("Sign in to unlink a TikTok account.", 401);
        // Only ever deletes the caller's own row.
        await unlinkAccount(caller.userId);
        return jsonOk({ ok: true });
      },
    },
  },
});
