import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { extractYouTubeId, parseYouTubeDuration, youtubeThumbnail, youtubeWatchUrl } from "./youtube";

/** A desktop UA — the mobile page omits the player config we parse. */
const YOUTUBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/**
 * Ask YouTube how long a video is, in seconds.
 *
 * oEmbed has no duration field, so we read the watch page and pull the length
 * out of the player config. Everything is best-effort: a bot check, a consent
 * wall or a live stream all just mean "no duration yet", never a failed add.
 */
async function fetchYouTubeDuration(id: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/watch?v=${encodeURIComponent(id)}&hl=en&has_verified=1&bpctr=9999999999`,
      {
        headers: {
          "user-agent": YOUTUBE_UA,
          "accept-language": "en-US,en;q=0.9",
          accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(8000),
      },
    );
    if (!response.ok) return null;
    return parseYouTubeDuration(await response.text());
  } catch {
    return null;
  }
}

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

    // Title and length both come from the network, so fetch them together and
    // let either one fail on its own.
    const [metadata, duration] = await Promise.all([
      (async () => {
        try {
          const response = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(data.id))}&format=json`,
            { signal: AbortSignal.timeout(8000) },
          );
          if (!response.ok) throw new Error("metadata unavailable");
          const json: unknown = await response.json();
          if (json && typeof json === "object" && "title" in json && typeof json.title === "string") {
            return json.title.slice(0, 500);
          }
        } catch {
          // Keep a thumbnail and an honest fallback title if YouTube metadata is unavailable.
        }
        return null;
      })(),
      fetchYouTubeDuration(data.id),
    ]);

    if (metadata) title = metadata;

    const { data: row, error } = await supabase
      .from("full_videos")
      .insert({
        user_id: userId,
        username: profile.handle,
        title,
        description: "",
        video_url: youtubeWatchUrl(data.id),
        thumbnail_url: youtubeThumbnail(data.id),
        is_youtube: true,
        youtube_id: data.id,
        duration: duration ?? 0,
        status: "ready",
        category: "All",
      })
      .select("*")
      .single();
    if (error || !row) throw new Error("Could not add the YouTube video. Please try again.");
    return { ...row, status: "ready" as const };
  });

/**
 * Fill in the length for YouTube rows that were added before we knew how to
 * read it (they sit at `duration = 0`, so the grid shows no badge).
 *
 * The grid calls this for the cards it is about to draw; the answer is written
 * back to the row so the next visitor gets it straight from the database and
 * never pays for the scrape. Only ids already marked `is_youtube` are touched,
 * and the response is a plain id -> seconds map.
 */
export const refreshYouTubeDurations = createServerFn({ method: "POST" })
  .inputValidator((input: { ids: string[] }) => {
    if (!Array.isArray(input?.ids)) throw new Error("Nothing to look up.");
    const ids = input.ids
      .filter((id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(id))
      .slice(0, 24);
    return { ids: [...new Set(ids)] };
  })
  .handler(async ({ data }) => {
    const durations: Record<string, number> = {};
    if (data.ids.length === 0) return durations;

    // The admin client is optional here: without a service key we can still
    // hand the lengths back for this session, we just can't cache them.
    const admin = await import("@/integrations/supabase/client.server")
      .then((mod) => mod.supabaseAdmin)
      .catch(() => null);

    await Promise.all(
      data.ids.map(async (id) => {
        const seconds = await fetchYouTubeDuration(id);
        if (!seconds) return;
        durations[id] = seconds;
        // Persist so this lookup happens once per video, not once per view.
        try {
          await admin
            ?.from("full_videos")
            .update({ duration: seconds })
            .eq("is_youtube", true)
            .eq("youtube_id", id);
        } catch {
          // The badge still renders from the in-memory value this session.
        }
      }),
    );

    return durations;
  });

/**
 * Store lengths the browser measured with the YouTube IFrame player.
 *
 * The probe in `youtubeDurationProbe.ts` runs on the viewer's own connection,
 * which YouTube does not throttle, so it is the reliable path; this function
 * only writes the answer down. Values are clamped to a sane range and only
 * rows already flagged `is_youtube` are touched.
 */
export const saveYouTubeDurations = createServerFn({ method: "POST" })
  .inputValidator((input: { durations: Record<string, number> }) => {
    const entries = Object.entries(input?.durations ?? {}).filter(
      ([id, seconds]) =>
        typeof id === "string" &&
        /^[A-Za-z0-9_-]{1,64}$/.test(id) &&
        typeof seconds === "number" &&
        Number.isFinite(seconds) &&
        seconds > 0 &&
        seconds <= 43_200,
    ) as [string, number][];

    if (entries.length === 0) throw new Error("Nothing to save.");
    return { entries: entries.slice(0, 24).map(([id, seconds]) => [id, Math.round(seconds)] as const) };
  })
  .handler(async ({ data }) => {
    const admin = await import("@/integrations/supabase/client.server")
      .then((mod) => mod.supabaseAdmin)
      .catch(() => null);
    if (!admin) return { saved: 0 };

    await Promise.all(
      data.entries.map(async ([id, seconds]) => {
        try {
          await admin
            .from("full_videos")
            .update({ duration: seconds })
            .eq("is_youtube", true)
            .eq("youtube_id", id);
        } catch {
          // A failed write only costs us a repeat probe later.
        }
      }),
    );

    return { saved: data.entries.length };
  });
