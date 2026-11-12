import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabase } from "@/integrations/supabase/client";
import {
  extractYouTubeId,
  parseYouTubeDuration,
  youtubeThumbnail,
  youtubeWatchUrl,
} from "@/lib/youtube";
import { cacheSound, type Sound } from "@/lib/sounds";

/**
 * YouTube songs for the Music tab.
 *
 * A YouTube song is a normal `public.sounds` row with `source = 'youtube'`:
 *   title            -> the YouTube video title
 *   creator_username -> the YouTube channel
 *   youtube_url      -> the watch link
 *   cover_url        -> the YouTube thumbnail
 *   audio_url        -> "" (nothing is downloaded or re-hosted)
 *
 * Playback always happens inside YouTube's own embed player, so the full song
 * streams from YouTube and Coolerup never stores a copyrighted file.
 */

/** How much of a YouTube song a Short records ("a lil bit", TikTok-style). */
export const YOUTUBE_CLIP_SECONDS = 15;

/** A desktop UA — the mobile watch page omits the player config we parse. */
const YOUTUBE_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export type YouTubeMetadata = { title: string | null; author: string | null };

/** Title + channel from YouTube's oEmbed endpoint (no API key needed). */
async function fetchYouTubeMetadata(id: string): Promise<YouTubeMetadata> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeWatchUrl(id))}&format=json`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!response.ok) return { title: null, author: null };
    const json: unknown = await response.json();
    if (!json || typeof json !== "object") return { title: null, author: null };
    const record = json as { title?: unknown; author_name?: unknown };
    return {
      title: typeof record.title === "string" ? record.title.slice(0, 200) : null,
      author: typeof record.author_name === "string" ? record.author_name.slice(0, 100) : null,
    };
  } catch {
    return { title: null, author: null };
  }
}

/** Full song length in seconds, read from the watch page's player config. */
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

/**
 * Add a YouTube song to the Music tab.
 *
 * The row is shared: pasting the same link twice returns the existing song
 * instead of creating a duplicate, so the play count stays in one place.
 */
export const addYouTubeSong = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { url: string }) => {
    if (typeof input?.url !== "string" || input.url.length > 2048) {
      throw new Error("Paste a valid YouTube link.");
    }
    const id = extractYouTubeId(input.url);
    if (!id) throw new Error("Paste a valid YouTube video link.");
    return { id };
  })
  .handler(async ({ data, context }) => {
    const { supabase: db, userId } = context;
    const watchUrl = youtubeWatchUrl(data.id);

    // Already in the library? Hand back the shared row.
    const existing = await db.from("sounds").select("*").eq("youtube_url", watchUrl).maybeSingle();
    if (existing.data) return existing.data as Sound;

    const [metadata, duration] = await Promise.all([
      fetchYouTubeMetadata(data.id),
      fetchYouTubeDuration(data.id),
    ]);

    const { data: profile } = await db
      .from("profiles")
      .select("handle")
      .eq("id", userId)
      .maybeSingle();

    const row = {
      original_video_id: null,
      audio_url: "",
      title: metadata.title ?? `YouTube song · ${data.id}`,
      creator_username: metadata.author ?? profile?.handle ?? "youtube",
      youtube_url: watchUrl,
      cover_url: youtubeThumbnail(data.id),
      source: "youtube" as const,
      uses_count: 0,
    };

    const { data: inserted, error } = await db.from("sounds").insert(row).select("*").single();
    if (error || !inserted) {
      // A concurrent add won the race — return that row.
      const again = await db.from("sounds").select("*").eq("youtube_url", watchUrl).maybeSingle();
      if (again.data) return again.data as Sound;
      throw new Error("Could not add this YouTube song. Please try again.");
    }
    return inserted as Sound;
  });

/** Every YouTube song in the Music tab, newest first. */
export async function getYouTubeSongs(limit = 50): Promise<Sound[]> {
  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .eq("source", "youtube")
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(200, limit)));
  if (error) throw error;
  const songs = (data ?? []) as Sound[];
  songs.forEach(cacheSound);
  return songs;
}

/** Count plays for a song opened in the Music player. */
export async function incrementSoundPlay(soundId: string): Promise<void> {
  const { error } = await supabase.rpc("increment_sound_play", { _sound_id: soundId });
  if (error) console.error("Couldn't count this play", error);
}

/** The video id behind a song row. */
export function youtubeSongId(sound: Pick<Sound, "youtube_url"> | null | undefined) {
  return extractYouTubeId(sound?.youtube_url ?? "");
}

/**
 * Embed URL for the Music player.
 *
 * `enablejsapi=1` lets the player drive YouTube's IFrame API (play/pause/seek),
 * and `playsinline=1` keeps iOS from hijacking playback into fullscreen.
 */
export function youtubeEmbedUrl(
  id: string,
  opts: { autoplay?: boolean; start?: number; origin?: string | undefined } = {},
) {
  const params = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    modestbranding: "1",
    autoplay: opts.autoplay ? "1" : "0",
  });
  if (opts.start && opts.start > 0) params.set("start", String(Math.floor(opts.start)));
  if (opts.origin) params.set("origin", opts.origin);
  return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?${params.toString()}`;
}

/**
 * Where a Short starts inside the song.
 *
 * A deterministic offset from the song id means the same song always gives the
 * same 15-second clip (so two people using it get the same bit), while still
 * landing somewhere past the intro. Falls back to the start when the length is
 * unknown.
 */
export function youtubeClipStart(soundId: string, durationSeconds?: number): number {
  if (!durationSeconds || durationSeconds <= YOUTUBE_CLIP_SECONDS + 5) return 0;
  let hash = 0;
  for (let i = 0; i < soundId.length; i++) hash = (hash * 31 + soundId.charCodeAt(i)) >>> 0;
  const latest = Math.max(0, Math.floor(durationSeconds - YOUTUBE_CLIP_SECONDS - 1));
  // Skip the intro (~first 10%) and never run past the last 15 seconds.
  const earliest = Math.min(latest, Math.floor(durationSeconds * 0.1));
  return earliest + (hash % Math.max(1, latest - earliest + 1));
}
