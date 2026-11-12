import { supabase } from "@/integrations/supabase/client";
import { resolveVideoUrl, type Video } from "@/lib/loop";

/**
 * A copyright-safe "original sound". `audio_url` always points at the audio
 * track of a real user video (the source video file), never a commercial song.
 */
export type Sound = {
  id: string;
  /** Null for library sounds (e.g. the Christmas carols) that aren't a video's audio. */
  original_video_id: string | null;
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
 * The 10 "Christmas - ..." sounds by @coolerup, shown as their own section in
 * the sound picker while the Christmas update is live.
 */
export async function getChristmasSounds(): Promise<Sound[]> {
  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .eq("creator_username", "coolerup")
    .ilike("title", "Christmas - %")
    .order("title", { ascending: true });

  if (error) throw error;
  const sounds = (data ?? []) as Sound[];
  sounds.forEach(cacheSound);
  return sounds;
}

/**
 * The "GTA 6 - ..." sounds by @coolerup, shown as their own section in the
 * sound picker only while the GTA 6 update is live.
 */
export async function getGTA6Sounds(): Promise<Sound[]> {
  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .eq("creator_username", "coolerup")
    .ilike("title", "GTA 6 - %")
    .order("title", { ascending: true });

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
    _sound_id: soundId as string,
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

/* ===========================================================================
 * Music tab
 *
 * Everything below reads the SAME `public.sounds` table the Sounds player
 * already uses. No new songs are introduced, and nothing is fetched from
 * YouTube/Spotify — `audio_url` is always a Coolerup-owned file.
 * =========================================================================== */

/** A sound counts as a "full song" once its file runs longer than this. */
export const FULL_SONG_SECONDS = 25;

/** Top Songs — the 10 most-used sounds in Coolerup. */
export async function getTopSounds(limit = 10): Promise<Sound[]> {
  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .order("uses_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));

  if (error) throw error;
  const sounds = (data ?? []) as Sound[];
  sounds.forEach(cacheSound);
  return sounds;
}

/** Trending Sounds — sounds people actually used in videos this week. */
export async function getTrendingSoundsThisWeek(limit = 20): Promise<Sound[]> {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("sounds")
    .select("*")
    .gte("created_at", since)
    .order("uses_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(50, limit)));

  if (error) throw error;
  let sounds = (data ?? []) as Sound[];

  // A quiet week shouldn't leave the row empty — fall back to the all-time
  // chart, which is still "what people are using" just over a longer window.
  if (!sounds.length) sounds = await getTopSounds(limit);
  sounds.forEach(cacheSound);
  return sounds;
}

/** Ids of every sound the signed-in user saved with the heart button. */
export async function getSavedSoundIds(): Promise<Set<string>> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();

  const { data, error } = await supabase
    .from("saved_sounds")
    .select("sound_id")
    .eq("user_id", user.id);
  if (error) throw error;
  return new Set(((data ?? []) as { sound_id: string }[]).map((r) => r.sound_id));
}

/** "Your Sounds" — the saved songs, newest save first. */
export async function getSavedSounds(): Promise<Sound[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from("saved_sounds")
    .select("sound_id, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;

  const ids = ((data ?? []) as { sound_id: string }[]).map((r) => r.sound_id);
  if (!ids.length) return [];

  const { data: rows, error: soundsError } = await supabase
    .from("sounds")
    .select("*")
    .in("id", ids);
  if (soundsError) throw soundsError;

  const byId = new Map(((rows ?? []) as Sound[]).map((s) => [s.id, s]));
  const ordered = ids.map((id) => byId.get(id)).filter((s): s is Sound => Boolean(s));
  ordered.forEach(cacheSound);
  return ordered;
}

/** Save (heart) a sound. Idempotent. */
export async function saveSound(soundId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("saved_sounds")
    .upsert({ user_id: user.id, sound_id: soundId }, { onConflict: "user_id,sound_id" });
  if (error) {
    console.error("Couldn't save sound", error);
    return false;
  }
  return true;
}

/** Remove a sound from "Your Sounds". Idempotent. */
export async function unsaveSound(soundId: string): Promise<boolean> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { error } = await supabase
    .from("saved_sounds")
    .delete()
    .eq("user_id", user.id)
    .eq("sound_id", soundId);
  if (error) {
    console.error("Couldn't unsave sound", error);
    return false;
  }
  return true;
}

/**
 * Measured length of a sound file, in seconds. Cached for the session so
 * scrolling back and forth doesn't re-download metadata.
 *
 * `null` means "we couldn't read it" — the UI then treats the song as a clip
 * rather than claiming it's a full song.
 */
const durationCache = new Map<string, number | null>();

export async function probeSoundDuration(
  sound: Pick<Sound, "id" | "audio_url">,
): Promise<number | null> {
  if (durationCache.has(sound.id)) return durationCache.get(sound.id) ?? null;
  if (!sound.audio_url) {
    durationCache.set(sound.id, null);
    return null;
  }

  const seconds = await new Promise<number | null>((resolve) => {
    let settled = false;
    const done = (value: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      resolve(value);
    };

    const el = new Audio();
    el.preload = "metadata";
    el.muted = true;
    const timer = setTimeout(() => done(null), 5000);

    el.addEventListener("loadedmetadata", () => {
      const d = el.duration;
      done(Number.isFinite(d) && d > 0 ? d : null);
    });
    el.addEventListener("error", () => done(null));

    void soundAudioUrl(sound).then((url) => {
      if (!url) return done(null);
      el.src = url;
    });
  });

  durationCache.set(sound.id, seconds);
  return seconds;
}

/** Probe a list of sounds a few at a time so we don't hammer storage. */
export async function probeSoundDurations(
  sounds: Sound[],
  limit = 40,
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  const slice = sounds.slice(0, Math.max(1, limit));
  const BATCH = 6;
  for (let i = 0; i < slice.length; i += BATCH) {
    const batch = slice.slice(i, i + BATCH);
    const results = await Promise.all(batch.map((s) => probeSoundDuration(s)));
    batch.forEach((s, j) => out.set(s.id, results[j] ?? null));
  }
  return out;
}

/** Cached duration, or undefined when it hasn't been probed yet. */
export function getKnownDuration(soundId: string): number | null | undefined {
  return durationCache.get(soundId);
}

/** True when we've measured this sound and it's a real full-length track. */
export function isFullSong(soundId: string): boolean {
  const d = durationCache.get(soundId);
  return typeof d === "number" && d >= FULL_SONG_SECONDS;
}

/**
 * Cover art. The `sounds` table has no `cover_url` column, and inventing one
 * would mean storing fake images — so each song gets a stable gradient derived
 * from its id. Same song always looks the same, and it needs no network.
 */
const COVER_PALETTES = [
  ["#f97316", "#db2777"],
  ["#8b5cf6", "#3b82f6"],
  ["#06b6d4", "#22c55e"],
  ["#eab308", "#f97316"],
  ["#ec4899", "#8b5cf6"],
  ["#14b8a6", "#0ea5e9"],
  ["#ef4444", "#f59e0b"],
  ["#6366f1", "#ec4899"],
] as const;

export function soundCoverGradient(soundId: string): string {
  let hash = 0;
  for (let i = 0; i < soundId.length; i++) hash = (hash * 31 + soundId.charCodeAt(i)) >>> 0;
  const [from, to] = COVER_PALETTES[hash % COVER_PALETTES.length]!;
  return `linear-gradient(135deg, ${from}, ${to})`;
}

/** "1.2K plays" — the Music tab wording for `uses_count`. */
export function formatPlays(count: number): string {
  const n = Math.max(0, count);
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M plays`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K plays`;
  return `${n} ${n === 1 ? "play" : "plays"}`;
}

/** "0:42" */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
