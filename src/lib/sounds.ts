import { supabase } from "@/integrations/supabase/client";
import { resolveVideoUrl, type Video } from "@/lib/loop";

/**
 * A copyright-safe "original sound". `audio_url` always points at the audio
 * track of a real user video (the source video file), never a commercial song.
 */
export type Sound = {
  id: string;
  original_video_id: string;
  audio_url: string;
  title: string;
  creator_username: string;
  uses_count: number;
  created_at: string;
};

/** Resolved per-session so the feed doesn't refetch the same sound per card. */
const soundCache = new Map<string, Sound | null>();
const soundInflight = new Map<string, Promise<Sound | null>>();

export function getCachedSound(id: string | null | undefined): Sound | null {
  if (!id) return null;
  return soundCache.get(id) ?? null;
}

export function cacheSound(sound: Sound | null | undefined) {
  if (sound) soundCache.set(sound.id, sound);
}

/** Load a sound by id, deduping concurrent lookups. */
export async function getSound(id: string): Promise<Sound | null> {
  if (soundCache.has(id)) return soundCache.get(id) ?? null;
  const pending = soundInflight.get(id);
  if (pending) return pending;

  const promise = (async () => {
    try {
      const { data, error } = await supabase.from("sounds").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      const sound = (data as Sound | null) ?? null;
      soundCache.set(id, sound);
      return sound;
    } catch {
      soundCache.set(id, null);
      return null;
    } finally {
      soundInflight.delete(id);
    }
  })();

  soundInflight.set(id, promise);
  return promise;
}

/**
 * Trending sounds for the "Use sound from video" picker.
 * Ordered by uses_count desc, exactly like TikTok's sound discovery list.
 */
export async function getTrendingSounds(limit = 20, query = ""): Promise<Sound[]> {
  const q = query.trim().replace(/[%,()]/g, "");
  let request = supabase
    .from("sounds")
    .select("*")
    .order("uses_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));

  if (q) request = request.or(`title.ilike.%${q}%,creator_username.ilike.%${q}%`);

  const { data, error } = await request;
  if (error) throw error;
  const sounds = (data ?? []) as Sound[];
  sounds.forEach(cacheSound);
  return sounds;
}

/**
 * Every original sound in the library, most-used first. Used by the in-app
 * music player so users can listen to (and later reuse) sounds without opening
 * a video.
 */
export async function getAllSounds(limit = 200): Promise<Sound[]> {
  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .order("uses_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(500, limit)));

  if (error) throw error;
  const sounds = (data ?? []) as Sound[];
  sounds.forEach(cacheSound);
  return sounds;
}

/** Every video that used this sound, newest first (the sound page grid). */
export async function getSoundVideos(soundId: string): Promise<Video[]> {
  const { data, error } = await supabase
    .from("videos")
    .select(
      "id, username, caption, video_url, likes_count, comments_count, shares_count, reposts_count, created_at, sound_id",
    )
    .eq("sound_id", soundId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return ((data ?? []) as Video[]).map((v) => ({ ...v, reposts: v.reposts_count ?? 0 }));
}

/**
 * Create the "Original sound" row for an uploaded video and point the video at
 * it. The database also does this in an INSERT trigger; this helper keeps the
 * flow explicit and gives the client the new sound id immediately.
 */
export async function createSoundFromVideo(videoId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc("create_sound_from_video", { _video_id: videoId });
  if (error) {
    // The trigger may have already created it, or the RPC may not be deployed.
    return null;
  }
  const id = (data as string | null) ?? null;
  if (id) soundCache.delete(id);
  return id;
}

/**
 * Attach a sound to a video ("Use this sound"). The RPC updates uses_count for
 * both the old and new sound atomically.
 */
export async function useSound(videoId: string, soundId: string | null): Promise<boolean> {
  const { error } = await supabase.rpc("set_video_sound", {
    _video_id: videoId,
    _sound_id: soundId,
  });
  if (error) {
    console.error("Couldn't attach sound", error);
    return false;
  }
  if (soundId) soundCache.delete(soundId);
  return true;
}

/** Bump a sound's usage counter (used when a post is published). */
export async function incrementSoundUse(soundId: string): Promise<void> {
  const { error } = await supabase.rpc("increment_sound_use", { _sound_id: soundId });
  if (error) console.error("Couldn't increment sound uses", error);
}

/** Resolve a sound's audio source (handles the `storage:` prefix). */
export function soundAudioUrl(sound: Pick<Sound, "audio_url"> | null | undefined): Promise<string> {
  if (!sound?.audio_url) return Promise.resolve("");
  return resolveVideoUrl(sound.audio_url);
}

/** "613 videos using this sound" */
export function formatUses(count: number): string {
  const n = Math.max(0, count);
  return `${n.toLocaleString()} ${n === 1 ? "video" : "videos"} using this sound`;
}

/** Client-side fallback title, matching the SQL helper. */
export function soundTitleForVideo(caption: string, username: string): string {
  const clean = (caption ?? "").replace(/\s*\[\[(song:[^\]]*|full|baked)\]\]\s*/gi, "").trim();
  return clean || `Original sound - @${username}`;
}
