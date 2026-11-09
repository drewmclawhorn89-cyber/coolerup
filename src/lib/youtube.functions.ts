import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractYouTubeId, youtubeThumbnail, youtubeWatchUrl } from "./youtube";

export const addYouTubeVideo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string }) => {
    if (typeof input?.url !== "string" || input.url.length > 2048) throw new Error("Paste a valid YouTube link.");
    const id = extractYouTubeId(input.url);
    if (!id) throw new Error("Paste a valid YouTube video link.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: profile } = await supabase.from("profiles").select("handle").eq("id", userId).single();
    if (!profile) throw new Error("Finish setting up your profile first.");
    let title = `YouTube video · ${data.id}`;
    try {
      const response = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(data.id))}&format=json`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) throw new Error("metadata unavailable");
      const metadata: unknown = await response.json();
      if (metadata && typeof metadata === "object" && "title" in metadata && typeof metadata.title === "string") {
        title = metadata.title.slice(0, 500);
      }
    } catch {
      // Keep a thumbnail and an honest fallback title if YouTube metadata is unavailable.
    }
    const { data: row, error } = await supabase.from("full_videos").insert({
      user_id: userId, username: profile.handle, title, description: "",
      video_url: youtubeWatchUrl(data.id), thumbnail_url: youtubeThumbnail(data.id),
      is_youtube: true, youtube_id: data.id, status: "ready", category: "All",
    }).select("*").single();
    if (error || !row) throw new Error("Could not add the YouTube video. Please try again.");
    return { ...row, status: "ready" as const };
  });